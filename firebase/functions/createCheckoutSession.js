// Replaces the previous, undeployed createOrder — that function required
// an authenticated Firebase user (request.auth), but this site never had
// customer accounts, so it could never actually be called by a real
// customer. This is a plain HTTPS function, proxied through Astro's
// api/checkout.js the same way api/shipping.js already proxies to
// getShippingEstimate — no CORS handling needed since the browser never
// calls this directly.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { buildLineItemsFromCatalog, CatalogValidationError } = require('./lib/pricing');

if (!admin.apps.length) {
  admin.initializeApp();
}

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

// No SITE_URL env var convention exists elsewhere in this codebase
// (unsubscribe.js/eventNotification.js hardcode the domain inline) — same
// pattern here, with an env override for local/emulator testing.
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://myfriendroze.com';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Testable core — takes its dependencies (Firestore, Stripe client, site
 * origin) as parameters instead of reaching for module-level singletons, so
 * tests can inject fakes without mocking the stripe/firebase-admin modules
 * themselves. The exported onRequest handler below is the only thing that
 * wires in the real dependencies.
 */
async function handleCreateCheckoutSession(req, res, { db, stripeClient, siteOrigin }) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { customer, items, notes } = req.body || {};

  if (!customer || !customer.email || !isValidEmail(customer.email) || !customer.name) {
    return res.status(400).json({ error: 'customer.email and customer.name are required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  try {
    const docs = await Promise.all(
      items.map((item) => db.collection('products').doc(item.sku).get())
    );

    const catalog = new Map();
    docs.forEach((doc, i) => {
      if (doc.exists) {
        catalog.set(items[i].sku, doc.data());
      }
    });

    const lineItems = buildLineItemsFromCatalog(items, catalog);

    const session = await stripeClient.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: ['US'] },
      customer_email: customer.email,
      success_url: `${siteOrigin}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteOrigin}/order/cancelled`,
      metadata: {
        customerName: customer.name,
        ...(customer.phone && { customerPhone: customer.phone }),
        ...(notes && { notes }),
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    logger.error('createCheckoutSession error:', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}

/* v8 ignore start -- thin wiring that constructs real dependencies (a live
   Stripe client from the deployed secret, the real Firestore instance) and
   hands off to the already-tested handleCreateCheckoutSession above.
   Verified via the emulator + Stripe test mode (see the plan's
   verification section), not a unit test — mocking `require('stripe')`
   here would test the mock, not this wiring. */
exports.createCheckoutSession = onRequest(
  { region: 'us-west1', secrets: [stripeSecretKey] },
  async (req, res) => {
    const stripeClient = require('stripe')(stripeSecretKey.value());
    return handleCreateCheckoutSession(req, res, {
      db: admin.firestore(),
      stripeClient,
      siteOrigin: SITE_ORIGIN,
    });
  }
);
/* v8 ignore stop */

// Exported separately for testing — see handleCreateCheckoutSession's
// own doc comment for why.
exports.handleCreateCheckoutSession = handleCreateCheckoutSession;
