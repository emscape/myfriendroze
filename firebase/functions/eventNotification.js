const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const functions = require("firebase-functions");
const { eventNotificationEmailParams } = require("./lib/emailPayload");
const { generateUnsubscribeToken } = require("./lib/unsubscribeToken");

// Define secrets
const brevoApiKey = defineSecret("BREVO_API_KEY");
const brevoTemplates = defineSecret("BREVO_TEMPLATES");
const unsubscribeSecret = defineSecret("UNSUBSCRIBE_SECRET");

if (!admin.apps.length) {
  admin.initializeApp();
}

// Same admin allowlist as orderConfirmation.js/firestore.rules' isAdmin() --
// kept in sync manually since Cloud Functions can't reference security rules.
const ADMIN_EMAILS = ['myfriendroze@gmail.com', 'myfriendroze.store@gmail.com'];

const UNSUBSCRIBE_BASE_URL = "https://us-west1-myfriendroze-platform.cloudfunctions.net/unsubscribe";

function buildUnsubscribeLinks(email, secret) {
  return {
    events: `${UNSUBSCRIBE_BASE_URL}?email=${encodeURIComponent(email)}&type=events&token=${generateUnsubscribeToken(email, 'events', secret)}`,
    all: `${UNSUBSCRIBE_BASE_URL}?email=${encodeURIComponent(email)}&type=all&token=${generateUnsubscribeToken(email, 'all', secret)}`,
  };
}

/**
 * Testable core — see createCheckoutSession.js's handleCreateCheckoutSession
 * for why dependencies are passed as parameters.
 */
async function handleSendEventNotification(request, {
  db, sendBrevoEmail, apiKey, templates, eventsSender, secret, serverTimestamp, logger,
}) {
  if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email)) {
    throw new HttpsError('permission-denied', 'Admin access required');
  }

  const { eventDetails } = request.data || {};

  if (!eventDetails) {
    throw new HttpsError('invalid-argument', 'Event details are required');
  }

  try {
    // Get all subscribers who want event notifications
    const subscribersSnapshot = await db
      .collection("newsletter_signups")
      .where("preferences.events", "==", true)
      .get();

    if (subscribersSnapshot.empty) {
      logger.info("No subscribers found for event notifications");
      return { success: true, message: "No subscribers to notify", emailsSent: 0 };
    }

    const subscribers = subscribersSnapshot.docs.map(doc => doc.data().email);
    logger.info(`Found ${subscribers.length} subscribers for event notifications`);

    // Save event to Firestore.
    //
    // isActive: true makes this doc match the `/events` page's live query
    // (astro/src/lib/events-live.js), which filters on isActive — without
    // it, an event created here would silently never appear on the site.
    //
    // KNOWN GAP: eventDetails here is caller-supplied and, going by the
    // EVENT_DATE/EVENT_TIME fields used below for the Brevo email, is
    // expected to carry legacy `date`/`time` strings, not a Firestore
    // Timestamp `eventDate` field. astro/src/lib/event-mapping.js requires
    // a real `eventDate` Timestamp and drops any doc without one, so an
    // event created through this function still won't appear on the site
    // even with isActive set. This function has no current callers (see
    // the Brevo Transactional Emails Session notes) — needs a real design
    // pass to collect a structured eventDate before it's wired up to
    // anything, rather than guessing a caller contract that doesn't exist
    // yet.
    const eventRef = await db.collection("events").add({
      ...eventDetails,
      isActive: true,
      timestamp: serverTimestamp(),
      notificationSent: true,
      recipientCount: subscribers.length
    });

    logger.info(`Successfully saved event ${eventRef.id} to Firestore.`);

    // Send event notification emails
    if (apiKey && eventsSender && subscribers.length > 0) {
      // Send individual emails with personalized unsubscribe links
      const emailPromises = subscribers.map((subscriberEmail) => {
        const { events: unsubscribeEvents, all: unsubscribeAll } =
          buildUnsubscribeLinks(subscriberEmail, secret);

        return sendBrevoEmail({
          sender: eventsSender,
          to: [{ email: subscriberEmail }],
          templateId: templates.eventNotification,
          params: eventNotificationEmailParams(eventDetails, subscriberEmail, unsubscribeEvents, unsubscribeAll)
        });
      });

      const responses = await Promise.allSettled(emailPromises);

      // Check for any failed sends -- deliberately logs the subscriber's
      // position, not their email address (PII), in the failure log.
      const failedSends = responses.filter(result => result.status === 'rejected');
      if (failedSends.length > 0) {
        logger.warn(`${failedSends.length} event notification emails failed to send`);
        failedSends.forEach((failure, index) => {
          logger.error(`Event notification send failed for subscriber ${index + 1}/${subscribers.length}:`, failure.reason);
        });
      }

      const successfulSends = responses.filter(result => result.status === 'fulfilled').length;
      logger.info(`Successfully sent event notification to ${successfulSends}/${subscribers.length} subscribers`);
    } else {
      logger.warn("Brevo API key or events sender not configured. Skipping email.");
    }

    return {
      success: true,
      message: "Event notification sent!",
      eventId: eventRef.id,
      emailsSent: subscribers.length
    };

  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    logger.error("Event notification error:", error);
    throw new HttpsError('internal', 'Failed to send event notification');
  }
}

/* v8 ignore start -- thin wiring, same rationale as createCheckoutSession.js
   and orderConfirmation.js's wrappers. */
exports.sendEventNotification = onCall({
  region: "us-west1",
  secrets: [brevoApiKey, brevoTemplates, unsubscribeSecret]
}, async (request) => {
  const apiKey = brevoApiKey.value();
  const templates = JSON.parse(brevoTemplates.value());
  const eventsSender = JSON.parse(process.env.EMAIL_EVENTS || functions.config().email?.events || '{"email":"events@myfriendroze.com","name":"MyFriendRoze Events"}');

  return handleSendEventNotification(request, {
    db: admin.firestore(),
    apiKey,
    templates,
    eventsSender,
    secret: unsubscribeSecret.value(),
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    logger,
    sendBrevoEmail: (payload) => fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
  });
});
/* v8 ignore stop */

// Exported separately for testing.
exports.handleSendEventNotification = handleSendEventNotification;
exports.HttpsError = HttpsError;
