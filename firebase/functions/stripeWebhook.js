// Receives Stripe's checkout.session.completed webhook and is the only
// place an order actually gets created — createCheckoutSession.js only
// starts a payment attempt, it never writes to Firestore. That split is
// deliberate: an "order" should only ever exist for a transaction Stripe
// has confirmed was actually paid.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { sessionToOrderData } = require('./lib/orderFromSession');
// sendOrderConfirmationEmail/orderDataToConfirmationEmailParams are only
// used inside the v8-ignored wrapper below, never by the testable core
// (which receives sendConfirmationEmail as an injected parameter) —
// required lazily there instead of here. A module-scope require executes
// on load regardless of whether the required function is ever called,
// which was creating an always-present-but-never-exercised module
// instance that diluted coverage reporting for those two files.

// Same env-var-driven convention as the original orderConfirmation.js —
// no SITE_URL-style convention exists in this codebase for this either.
const ORDERS_SENDER =
  process.env.EMAIL_ORDERS || '{"email":"orders@myfriendroze.com","name":"MyFriendRoze Orders"}';

if (!admin.apps.length) {
  admin.initializeApp();
}

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const brevoApiKey = defineSecret('BREVO_API_KEY');
const brevoTemplates = defineSecret('BREVO_TEMPLATES');

/**
 * Testable core — see createCheckoutSession.js's handleCreateCheckoutSession
 * for why dependencies are passed as parameters instead of module-level
 * singletons. Signature verification here uses the REAL stripe SDK's
 * webhooks.constructEvent (injected via stripeClient.webhooks), not a mock —
 * it's pure local HMAC computation, no network call, so there's no reason
 * to fake it.
 */
async function handleStripeWebhook(
  req,
  res,
  { stripeClient, webhookSecret, db, sendConfirmationEmail, serverTimestamp }
) {
  let event;
  try {
    event = stripeClient.webhooks.constructEvent(
      req.rawBody,
      req.headers['stripe-signature'],
      webhookSecret
    );
  } catch (err) {
    logger.warn('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Other event types are acknowledged, not treated as errors — Stripe
  // retries on non-2xx responses, and there's nothing to retry here.
  // charge.refunded / charge.dispute.created are intentionally unhandled
  // (v1.1 backlog item — see project_backlog memory): Firestore order
  // status can go stale relative to a Dashboard-issued refund with no
  // automatic reconciliation today.
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const lineItemsResponse = await stripeClient.checkout.sessions.listLineItems(session.id);
  const orderData = sessionToOrderData(session, lineItemsResponse.data);

  // The Checkout Session ID doubles as the Firestore document ID — a
  // duplicate webhook delivery (Stripe does not guarantee exactly-once
  // delivery) becomes a harmless repeat read instead of a duplicate order.
  const orderRef = db.collection('orders').doc(session.id);

  const alreadyHandled = await db.runTransaction(async (tx) => {
    const doc = await tx.get(orderRef);
    if (doc.exists && doc.data().status === 'paid') {
      return true;
    }
    tx.set(orderRef, {
      ...orderData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return false;
  });

  if (!alreadyHandled) {
    await sendConfirmationEmail(orderData);
  }

  return res.status(200).json({ received: true });
}

/* v8 ignore start -- thin wiring: constructs real dependencies (live Stripe
   client, real Firestore, real Brevo email sender) from deployed secrets
   and hands off to the already-tested handleStripeWebhook above. Verified
   via the Stripe CLI (stripe trigger checkout.session.completed) against
   the emulator, not a unit test. */
exports.stripeWebhook = onRequest(
  { region: 'us-west1', secrets: [stripeSecretKey, stripeWebhookSecret, brevoApiKey, brevoTemplates] },
  async (req, res) => {
    const stripeClient = require('stripe')(stripeSecretKey.value());
    const { sendOrderConfirmationEmail } = require('./lib/sendOrderConfirmationEmail');
    const { orderDataToConfirmationEmailParams } = require('./lib/emailPayload');
    return handleStripeWebhook(req, res, {
      stripeClient,
      webhookSecret: stripeWebhookSecret.value(),
      db: admin.firestore(),
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
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
exports.handleStripeWebhook = handleStripeWebhook;
