const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const functions = require("firebase-functions");
const { orderShippedEmailParams } = require("./lib/emailPayload");

// Define secrets
const brevoApiKey = defineSecret("BREVO_API_KEY");
const brevoTemplates = defineSecret("BREVO_TEMPLATES");

if (!admin.apps.length) {
  admin.initializeApp();
}

// Same admin allowlist as orderConfirmation.js/eventNotification.js/
// firestore.rules' isAdmin() -- kept in sync manually since Cloud Functions
// can't reference security rules. Without this check, this callable would
// be a public, unauthenticated endpoint that lets anyone mark an arbitrary
// order "shipped" in Firestore and relay a Brevo email to any address of
// their choosing through this project's verified sending domain.
const ADMIN_EMAILS = ['myfriendroze@gmail.com', 'myfriendroze.store@gmail.com'];

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Testable core — see eventNotification.js's handleSendEventNotification
 * for why dependencies are passed as parameters.
 */
async function handleSendOrderShippedNotification(request, {
  db, sendBrevoEmail, apiKey, templates, ordersSender, serverTimestamp, logger,
}) {
  if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email)) {
    throw new HttpsError('permission-denied', 'Admin access required');
  }

  logger.info("Order shipped notification function triggered.");

  const { email, orderDetails, shippingDetails } = request.data;

  if (!email || !orderDetails || !shippingDetails) {
    logger.error("Missing required fields: email, orderDetails, or shippingDetails");
    throw new Error("Email, order details, and shipping details are required");
  }

  if (!isValidEmail(email)) {
    logger.error("Invalid email address provided.");
    throw new Error("Valid email address required");
  }

  try {
    // Update order status in Firestore
    const ordersRef = db.collection("orders");
    const orderQuery = await ordersRef.where("email", "==", email.toLowerCase().trim())
                                     .where("orderDetails.orderNumber", "==", orderDetails.orderNumber)
                                     .get();

    if (!orderQuery.empty) {
      const orderDoc = orderQuery.docs[0];
      await orderDoc.ref.update({
        status: "shipped",
        shippingDetails: shippingDetails,
        shippedAt: serverTimestamp()
      });
      logger.info(`Updated order ${orderDetails.orderNumber} status to shipped`);
    }

    // Send shipping notification email
    if (apiKey && ordersSender) {
      const payload = {
        sender: ordersSender,
        to: [{ email: email }],
        templateId: templates.orderShipped,
        params: orderShippedEmailParams(email, orderDetails, shippingDetails)
      };

      await sendBrevoEmail(payload);

      // Logs the order number, never the customer's raw email address --
      // same PII-logging fix as eventNotification.js.
      logger.info(`Successfully sent shipping notification for order ${orderDetails.orderNumber}`);
    } else {
      logger.warn("Brevo API key or orders sender not configured. Skipping email.");
    }

    return {
      success: true,
      message: "Shipping notification sent!",
      orderNumber: orderDetails.orderNumber,
      trackingNumber: shippingDetails.trackingNumber
    };

  } catch (error) {
    logger.error("Order shipped notification error:", error);
    throw new Error("Failed to send shipping notification");
  }
}

/* v8 ignore start -- thin wiring, same rationale as eventNotification.js's
   wrapper. */
exports.sendOrderShippedNotification = onCall({
  region: "us-west1",
  secrets: [brevoApiKey, brevoTemplates]
}, async (request) => {
  const { sendBrevoEmail: postToBrevo } = require("./lib/sendBrevoEmail");
  const apiKey = brevoApiKey.value();
  const templates = JSON.parse(brevoTemplates.value());
  const ordersSender = JSON.parse(process.env.EMAIL_ORDERS || functions.config().email?.orders || '{"email":"orders@myfriendroze.com","name":"myfriendroze Orders"}');

  return handleSendOrderShippedNotification(request, {
    db: admin.firestore(),
    apiKey,
    templates,
    ordersSender,
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
exports.handleSendOrderShippedNotification = handleSendOrderShippedNotification;
exports.HttpsError = HttpsError;
