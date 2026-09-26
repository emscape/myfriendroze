const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const functions = require("firebase-functions");
const { eventNotificationEmailParams } = require("./lib/emailPayload");
const { generateUnsubscribeToken } = require("./lib/unsubscribeToken");
// sendBrevoEmail required lazily inside the v8-ignored wrapper below, not
// here — see orderConfirmation.js's identical comment for why a
// module-scope require creates an always-present-but-never-exercised
// instance that dilutes coverage reporting for that file.

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
 *
 * eventId is the Firestore events/{eventId} doc ID -- this notifies
 * subscribers about an event Roze already created via the admin app's
 * add/edit event screen, mirroring orderShipped.js's orderId pattern,
 * rather than accepting a freeform eventDetails payload and creating a
 * second, disconnected event doc (the previous design, which used field
 * names like date/time/price that don't exist on the real Event model).
 */
async function handleSendEventNotification(request, {
  db, sendBrevoEmail, apiKey, templates, eventsSender, secret, serverTimestamp, logger,
}) {
  if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email)) {
    throw new HttpsError('permission-denied', 'Admin access required');
  }

  const { eventId } = request.data || {};

  if (!eventId) {
    throw new HttpsError('invalid-argument', 'Event ID is required');
  }

  try {
    const eventRef = db.collection("events").doc(eventId);
    const eventDoc = await eventRef.get();

    if (!eventDoc.exists) {
      throw new HttpsError('not-found', 'Event not found');
    }

    const event = eventDoc.data();

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

    let emailsSent = 0;

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
          params: eventNotificationEmailParams(event, subscriberEmail, unsubscribeEvents, unsubscribeAll)
        });
      });

      const responses = await Promise.allSettled(emailPromises);

      // Check for any failed sends -- deliberately logs the subscriber's
      // position, not their email address (PII), in the failure log. Walks
      // the original `responses` array (not a filtered copy) so `index`
      // stays the subscriber's real position even when some sends succeed.
      const failedCount = responses.filter(result => result.status === 'rejected').length;
      if (failedCount > 0) {
        logger.warn(`${failedCount} event notification emails failed to send`);
        responses.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Event notification send failed for subscriber ${index + 1}/${subscribers.length}:`, result.reason);
          }
        });
      }

      emailsSent = responses.filter(result => result.status === 'fulfilled').length;
      logger.info(`Successfully sent event notification to ${emailsSent}/${subscribers.length} subscribers`);
    } else {
      logger.warn("Brevo API key or events sender not configured. Skipping email.");
    }

    // Informational only -- deliberately NOT an idempotency guard like
    // orderShipped.js's claim transaction. Roze may legitimately re-notify
    // subscribers about the same event (e.g. a reminder closer to the
    // date), so a prior lastNotifiedAt must never block a later send.
    await eventRef.update({
      lastNotifiedAt: serverTimestamp(),
      lastNotificationRecipientCount: subscribers.length,
    });

    return {
      success: true,
      message: "Event notification sent!",
      eventId,
      emailsSent,
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
  const { sendBrevoEmail: postToBrevo } = require("./lib/sendBrevoEmail");
  const apiKey = brevoApiKey.value();
  const templates = JSON.parse(brevoTemplates.value());
  const eventsSender = JSON.parse(process.env.EMAIL_EVENTS || functions.config().email?.events || '{"email":"events@myfriendroze.com","name":"myfriendroze Events"}');

  return handleSendEventNotification(request, {
    db: admin.firestore(),
    apiKey,
    templates,
    eventsSender,
    secret: unsubscribeSecret.value(),
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    logger,
    // Response validation (including the non-2xx-is-not-a-rejection fix and
    // the PII-safe error message) lives in lib/sendBrevoEmail.js, where it's
    // unit tested directly -- this wrapper is just wiring, same as the rest
    // of this v8-ignored block.
    sendBrevoEmail: (payload) => postToBrevo({ apiKey, payload }),
  });
});
/* v8 ignore stop */

// Exported separately for testing.
exports.handleSendEventNotification = handleSendEventNotification;
exports.HttpsError = HttpsError;
