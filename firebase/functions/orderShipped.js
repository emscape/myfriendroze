const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { orderShippedEmailParams, formatAddressRaw } = require("./lib/emailPayload");

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

/**
 * Testable core — see eventNotification.js's handleSendEventNotification
 * for why dependencies are passed as parameters.
 *
 * orderId is the Stripe Checkout Session ID, which doubles as the Firestore
 * orders/ doc ID (see stripeWebhook.js) -- looking the order up directly by
 * doc ID instead of a where() query on {email, orderDetails.orderNumber}
 * fixes a bug found in PR #46 review: real order docs (lib/orderFromSession.js's
 * sessionToOrderData shape) have neither of those fields, so that query
 * always came back empty and this handler silently never updated the order
 * while still reporting success and emailing the customer.
 */
async function handleSendOrderShippedNotification(request, {
  db, sendBrevoEmail, apiKey, templates, ordersSender, serverTimestamp, logger,
}) {
  if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email)) {
    throw new HttpsError('permission-denied', 'Admin access required');
  }

  logger.info("Order shipped notification function triggered.");

  const { orderId, shippingDetails } = request.data || {};

  if (!orderId || !shippingDetails) {
    logger.error("Missing required fields: orderId or shippingDetails");
    throw new HttpsError('invalid-argument', 'Order ID and shipping details are required');
  }

  try {
    const orderRef = db.collection("orders").doc(orderId);

    // Atomically claim the order before sending anything: two concurrent
    // invocations (e.g. an admin double-click, or a client retry racing the
    // original attempt) must not both observe the notification as unsent
    // and both email the customer. A Firestore transaction guarantees only
    // one caller's write wins for a given document version -- the loser's
    // transaction is retried by the SDK and its re-read sees
    // shippedNotificationSentAt already set (found in PR #46 review).
    //
    // The claim-write happens here, before the email is actually sent,
    // trading away automatic retry-ability on a Brevo failure -- the order
    // stays marked shipped even if the send below fails. That's the same
    // tradeoff stripeWebhook.js already accepts for the order-confirmation
    // email (marks the order handled before emailing, no auto-retry if
    // sendConfirmationEmail fails): duplicate customer-facing emails from a
    // race are worse than a single unretried failure.
    const claim = await db.runTransaction(async (tx) => {
      const orderDoc = await tx.get(orderRef);

      if (!orderDoc.exists) {
        throw new HttpsError('not-found', 'Order not found');
      }

      const order = orderDoc.data();

      if (order.shippedNotificationSentAt) {
        return { alreadyNotified: true, order };
      }

      const email = order.customer?.email;
      if (!email) {
        throw new HttpsError('failed-precondition', 'Order has no customer email on file');
      }

      tx.update(orderRef, {
        status: "shipped",
        shippingDetails: shippingDetails,
        shippedAt: serverTimestamp(),
        shippedNotificationSentAt: serverTimestamp(),
      });

      return { alreadyNotified: false, order, email };
    });

    if (claim.alreadyNotified) {
      logger.info(`Order ${orderId} shipping notification already sent; skipping duplicate.`);
      return {
        success: true,
        message: "Order was already marked shipped; no duplicate notification sent.",
        orderId,
        trackingNumber: claim.order.shippingDetails?.trackingNumber,
      };
    }

    logger.info(`Updated order ${orderId} status to shipped`);

    const { order, email } = claim;

    // Send shipping notification email
    let emailSent = false;
    if (apiKey && ordersSender) {
      const orderDetails = {
        orderNumber: order.stripeSessionId,
        customerName: order.customer?.name,
        // Raw (unescaped) -- orderShippedEmailParams applies the single
        // escaping pass. formatAddress here would double-escape (see
        // formatAddressRaw's own comment).
        shippingAddress: formatAddressRaw(order.shippingAddress),
      };
      const payload = {
        sender: ordersSender,
        to: [{ email: email }],
        templateId: templates.orderShipped,
        params: orderShippedEmailParams(email, orderDetails, shippingDetails)
      };

      await sendBrevoEmail(payload);
      emailSent = true;

      // Logs the order id, never the customer's raw email address -- same
      // PII-logging fix as eventNotification.js.
      logger.info(`Successfully sent shipping notification for order ${orderId}`);
    } else {
      logger.warn("Brevo API key or orders sender not configured. Skipping email.");
    }

    return {
      success: true,
      // The claim above already committed status: "shipped" regardless of
      // what happens next, so success stays true either way -- but the
      // message must not claim an email went out when it didn't.
      message: emailSent
        ? "Shipping notification sent!"
        : "Order marked as shipped, but no notification email was sent (Brevo not configured).",
      orderId,
      trackingNumber: shippingDetails.trackingNumber
    };

  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
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
  // functions.config() (Firebase Functions v1 config API) is retired --
  // its backing Cloud Runtime Configuration API shut down 2025-12-31 -- so
  // this only ever falls through to the JSON literal default now.
  const ordersSender = JSON.parse(process.env.EMAIL_ORDERS || '{"email":"orders@myfriendroze.com","name":"myfriendroze Orders"}');

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
