// Receives Stripe's checkout.session.completed webhook and is the only
// place an order actually gets created — createCheckoutSession.js only
// starts a payment attempt (and holds one-of-a-kind pieces), it never
// writes an order. That split is deliberate: an "order" should only ever
// exist for a transaction Stripe has confirmed was actually paid.
//
// An order is written only once the payment is collected:
// checkout.session.completed with payment_status 'paid', or
// checkout.session.async_payment_succeeded for a delayed payment method.
// checkout.session.expired and async_payment_failed release the holds that
// createCheckoutSession put on one-of-a-kind pieces (lib/checkoutHolds.js).
// The Stripe webhook endpoint must be subscribed to all four events.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { sessionToOrderData } = require('./lib/orderFromSession');
const {
  releaseHolds,
  holdForPendingPayment,
  readSessionHolds,
  writePiecesSold,
  PENDING_PAYMENT_HOLD_MS,
} = require('./lib/checkoutHolds');
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
  process.env.EMAIL_ORDERS || '{"email":"orders@myfriendroze.com","name":"myfriendroze Orders"}';

// Order numbers count up from here (counters/orders holds the next one).
const FIRST_ORDER_NUMBER = 1001;

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
  { stripeClient, webhookSecret, db, sendConfirmationEmail, serverTimestamp, now = Date.now }
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
  const session = event.data.object;
  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    // Unpaid: free its one-of-a-kind pieces for other shoppers. Holds also
    // lapse on their own (lib/checkoutHolds.js) if this event never arrives.
    await releaseHolds(db, session.id);
    return res.status(200).json({ received: true });
  }
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return res.status(200).json({ received: true });
  }
  // A delayed payment method completes the checkout before the money
  // arrives. Keep its pieces held, with no order yet; Stripe follows up
  // with async_payment_succeeded (handled below) or async_payment_failed.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    await holdForPendingPayment(db, session.id, now() + PENDING_PAYMENT_HOLD_MS);
    return res.status(200).json({ received: true });
  }

  const lineItemsResponse = await stripeClient.checkout.sessions.listLineItems(session.id, {
    // Stripe returns 10 per page by default; a Checkout Session holds at
    // most 100 line items, so one page of 100 always covers the order.
    limit: 100,
  });
  // The session carries only the chosen shipping rate's id; its metadata
  // says which option it was (free shipping and pickup both cost $0).
  // A failed lookup must not block the order: it's saved with the shipping
  // amount and no method rather than left for Stripe to retry.
  const shippingRateId = session.shipping_cost?.shipping_rate;
  let shippingRate = null;
  if (shippingRateId) {
    try {
      shippingRate = await stripeClient.shippingRates.retrieve(shippingRateId);
    } catch (error) {
      logger.warn('Could not look up the shipping rate for session', session.id, error.message);
    }
  }
  const orderData = sessionToOrderData(session, lineItemsResponse.data, shippingRate);
  if (orderData.shipping?.outsideLocalArea) {
    // Session id only: no customer details in logs.
    logger.warn('Local pickup order with an address outside Los Angeles:', session.id);
  }

  // The Checkout Session ID doubles as the Firestore document ID — a
  // duplicate webhook delivery (Stripe does not guarantee exactly-once
  // delivery) becomes a harmless repeat read instead of a duplicate order.
  const orderRef = db.collection('orders').doc(session.id);

  const counterRef = db.collection('counters').doc('orders');

  // null when this checkout already has an order (a duplicate delivery).
  const claimed = await db.runTransaction(async (tx) => {
    const doc = await tx.get(orderRef);
    // doc.exists alone, not status === 'paid': this doc is only ever
    // created once, right here, keyed by session ID -- any existing doc
    // means this checkout was already processed, whatever its current
    // status. orderShipped.js later transitions status to 'shipped'; a
    // duplicate webhook delivery arriving after that must not resurrect
    // the order back to 'paid' and wipe its shippingDetails/shippedAt
    // (found in PR #46 review).
    if (doc.exists) {
      return null;
    }
    // Same transaction as the order, so a paid checkout's one-of-a-kind
    // pieces are sold exactly when its order exists.
    const held = await readSessionHolds(tx, db, session.id);
    // Short, customer-facing order number, taken in the same transaction
    // so concurrent orders never share one and a duplicate delivery
    // (returned above) never uses one up. Read before any write, as
    // Firestore transactions require.
    const counter = await tx.get(counterRef);
    const orderNumber = counter.exists ? counter.data().next : FIRST_ORDER_NUMBER;
    writePiecesSold(tx, held);
    tx.set(counterRef, { next: orderNumber + 1 });
    tx.set(orderRef, {
      ...orderData,
      orderNumber,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { orderNumber };
  });

  if (claimed) {
    await sendConfirmationEmail({ ...orderData, orderNumber: claimed.orderNumber });
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
