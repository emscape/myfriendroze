const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const functions = require("firebase-functions");

// Define secrets
const brevoApiKey = defineSecret("BREVO_API_KEY");
const brevoTemplates = defineSecret("BREVO_TEMPLATES");

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.sendEventNotification = onCall({
  region: "us-west1",
  secrets: [brevoApiKey, brevoTemplates]
}, async (request) => {
  logger.info("Event notification function triggered.");

  // Get secret values and config
  const apiKey = brevoApiKey.value();
  const templates = JSON.parse(brevoTemplates.value());
  const eventsSender = JSON.parse(process.env.EMAIL_EVENTS || functions.config().email?.events || '{"email":"events@myfriendroze.com","name":"MyFriendRoze Events"}');

  const { eventDetails } = request.data;

  if (!eventDetails) {
    logger.error("Missing required field: eventDetails");
    throw new Error("Event details are required");
  }

  try {
    // Get all subscribers who want event notifications
    const subscribersSnapshot = await admin.firestore()
      .collection("newsletter_signups")
      .where("preferences.events", "==", true)
      .get();

    if (subscribersSnapshot.empty) {
      logger.info("No subscribers found for event notifications");
      return { success: true, message: "No subscribers to notify", emailsSent: 0 };
    }

    const subscribers = subscribersSnapshot.docs.map(doc => doc.data().email);
    logger.info(`Found ${subscribers.length} subscribers for event notifications`);

    // Save event to Firestore
    const eventRef = await admin.firestore().collection("events").add({
      ...eventDetails,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      notificationSent: true,
      recipientCount: subscribers.length
    });

    logger.info(`Successfully saved event ${eventRef.id} to Firestore.`);

    // Send event notification emails
    if (apiKey && eventsSender && subscribers.length > 0) {
      // Send individual emails with personalized unsubscribe links
      const emailPromises = subscribers.map(async (subscriberEmail) => {
        // Generate unsubscribe URLs for this subscriber
        const crypto = require("crypto");
        const secret = process.env.UNSUBSCRIBE_SECRET || 'default-secret-change-me';
        const eventsToken = crypto.createHmac('sha256', secret).update(`${subscriberEmail}:events`).digest('hex');
        const allToken = crypto.createHmac('sha256', secret).update(`${subscriberEmail}:all`).digest('hex');

        const baseUrl = "https://us-west1-myfriendroze-platform.cloudfunctions.net/unsubscribe";
        const unsubscribeEvents = `${baseUrl}?email=${encodeURIComponent(subscriberEmail)}&type=events&token=${eventsToken}`;
        const unsubscribeAll = `${baseUrl}?email=${encodeURIComponent(subscriberEmail)}&type=all&token=${allToken}`;

        const brevoPayload = {
          sender: eventsSender,
          to: [{ email: subscriberEmail }],
          templateId: templates.eventNotification,
          params: {
            EMAIL: subscriberEmail,
            EVENT_TITLE: eventDetails.title || 'Special Event',
            EVENT_DATE: eventDetails.date || '',
            EVENT_TIME: eventDetails.time || '',
            EVENT_LOCATION: eventDetails.location || '',
            EVENT_DESCRIPTION: eventDetails.description || '',
            EVENT_PRICE: eventDetails.price || '',
            REGISTRATION_URL: eventDetails.registrationUrl || '',
            UNSUBSCRIBE_EVENTS: unsubscribeEvents,
            UNSUBSCRIBE_ALL: unsubscribeAll
          }
        };

        return fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(brevoPayload),
        });
      });

      const responses = await Promise.allSettled(emailPromises);

      // Check for any failed sends
      const failedSends = responses.filter(result => result.status === 'rejected');
      if (failedSends.length > 0) {
        logger.warn(`${failedSends.length} event notification emails failed to send`);
        failedSends.forEach((failure, index) => {
          logger.error(`Failed to send to ${subscribers[index]}:`, failure.reason);
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
    logger.error("Event notification error:", error);
    throw new Error("Failed to send event notification");
  }
});
