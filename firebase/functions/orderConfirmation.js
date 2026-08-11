// Admin-only "resend confirmation email" action. Not wired to any UI yet
// (a future Flutter admin-app feature) — kept here since it's a natural
// use for the shared email-sending helper. Does NOT write to Firestore —
// stripeWebhook.js owns order creation now, idempotently, keyed on the
// Stripe session ID. This file used to conflate "create the order" with
// "send the email"; that conflict is why it needed rewriting rather than
// just relocating, once the webhook took over order creation.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
// sendOrderConfirmationEmail/orderDataToConfirmationEmailParams required
// lazily inside the v8-ignored wrapper below, not here — see
// stripeWebhook.js's identical comment for why a module-scope require
// creates an always-present-but-never-exercised instance that dilutes
// coverage reporting for those two files.

if (!admin.apps.length) {
  admin.initializeApp();
}

const brevoApiKey = defineSecret('BREVO_API_KEY');
const brevoTemplates = defineSecret('BREVO_TEMPLATES');

// Same admin allowlist as firestore.rules/storage.rules' isAdmin() — kept
// in sync manually since Cloud Functions can't reference security rules.
const ADMIN_EMAILS = ['myfriendroze@gmail.com', 'myfriendroze.store@gmail.com'];

const ORDERS_SENDER =
  process.env.EMAIL_ORDERS || '{"email":"orders@myfriendroze.com","name":"MyFriendRoze Orders"}';

/**
 * Testable core — see createCheckoutSession.js's handleCreateCheckoutSession
 * for why dependencies are passed as parameters.
 */
async function handleResendOrderConfirmation(request, { db, sendConfirmationEmail }) {
  if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email)) {
    throw new HttpsError('permission-denied', 'Admin access required');
  }

  const { orderId } = request.data || {};
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required');
  }

  const doc = await db.collection('orders').doc(orderId).get();
  if (!doc.exists) {
    throw new HttpsError('not-found', `No order found for id: ${orderId}`);
  }

  await sendConfirmationEmail(doc.data());
  return { success: true };
}

/* v8 ignore start -- thin wiring, same rationale as createCheckoutSession.js
   and stripeWebhook.js's wrappers. */
exports.resendOrderConfirmation = onCall(
  { region: 'us-west1', secrets: [brevoApiKey, brevoTemplates] },
  async (request) => {
    const { sendOrderConfirmationEmail } = require('./lib/sendOrderConfirmationEmail');
    const { orderDataToConfirmationEmailParams } = require('./lib/emailPayload');
    return handleResendOrderConfirmation(request, {
      db: admin.firestore(),
      sendConfirmationEmail: async (orderData) => {
        const templates = JSON.parse(brevoTemplates.value());
        await sendOrderConfirmationEmail({
          apiKey: brevoApiKey.value(),
          sender: JSON.parse(ORDERS_SENDER),
          templateId: templates.orderConfirmation,
          email: orderData.customer.email,
          params: orderDataToConfirmationEmailParams(orderData),
        });
      },
    });
  }
);
/* v8 ignore stop */

// Exported separately for testing.
exports.handleResendOrderConfirmation = handleResendOrderConfirmation;
exports.HttpsError = HttpsError;
