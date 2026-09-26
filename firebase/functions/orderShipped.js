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
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      throw new HttpsError('not-found', 'Order not found');
    }

    const order = orderDoc.data();

    // Idempotency guard: a client can legitimately retry this callable
    // (e.g. after a timeout with an ambiguous response), and repeat
    // invocations for an already-notified order must not resend the
    // customer's shipping email (found in PR #46 review). Keyed on this
    // marker rather than status === 'shipped' alone so a request that
    // updated status but failed before the email went out (see below)
    // still gets a genuine retry.
    if (order.shippedNotificationSentAt) {
      logger.info(`Order ${orderId} shipping notification already sent; skipping duplicate.`);
      return {
        success: true,
        message: "Order was already marked shipped; no duplicate notification sent.",
        orderId,
        trackingNumber: order.shippingDetails?.trackingNumber,
      };
    }

    const email = order.customer?.email;

    if (!email) {
      throw new HttpsError('failed-precondition', 'Order has no customer email on file');
    }

    // Send the email before writing to Firestore (not after): if
    // sendBrevoEmail throws, the order is left untouched -- still 'paid',
    // not marked shipped -- so a client retry legitimately re-attempts the
    // send instead of finding a "shipped" order it can't safely act on
    // (found in PR #46 review).
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

    await orderRef.update({
      status: "shipped",
      shippingDetails: shippingDetails,
      shippedAt: serverTimestamp(),
      // Only set once the email has actually gone out -- its presence is
      // exactly the idempotency signal checked above. Omitted (not written
      // false/null) when Brevo isn't configured, so a later retry once it
      // is configured still attempts the real send.
      ...(emailSent && { shippedNotificationSentAt: serverTimestamp() }),
    });
    logger.info(`Updated order ${orderId} status to shipped`);

    return {
      success: true,
      // The order status update above always happens if we got this far
      // (an unfound order or Firestore failure already returned/threw), so
      // success itself stays true either way -- but the message must not
      // claim an email went out when it didn't.
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
