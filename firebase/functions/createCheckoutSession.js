// Replaces the previous, undeployed createOrder — that function required
// an authenticated Firebase user (request.auth), but this site never had
// customer accounts, so it could never actually be called by a real
// customer. This is a plain HTTPS function, proxied through Astro's
// api/checkout.js -- no CORS handling needed since the browser never calls
// this directly. Unlike api/checkout.js, api/shipping.js does NOT proxy to
// a Cloud Function: it computes USPS Ground Advantage rates itself, in
// Astro's own SSR runtime (see astro/src/lib/usps-rate-fetcher.js).

const { randomBytes } = require('node:crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { buildLineItemsFromCatalog, validateItemList, CatalogValidationError } = require('./lib/pricing');
const {
  isOneOfAKind,
  readHolds,
  checkHolds,
  reservePieces,
  hashToken,
  holdForPendingPayment,
  PENDING_PAYMENT_HOLD_MS,
  CHECKOUT_LIFETIME_SECONDS,
  HOLD_GRACE_MS,
} = require('./lib/checkoutHolds');

if (!admin.apps.length) {
  admin.initializeApp();
}

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

// No SITE_URL env var convention exists elsewhere in this codebase
// (unsubscribe.js/eventNotification.js hardcode the domain inline) — same
// pattern here, with an env override for local/emulator testing.
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://myfriendroze.com';

// Shape of the tokens newReplaceToken issues; anything else is ignored.
const REPLACE_TOKEN = /^[0-9a-f]{64}$/;

function newReplaceToken() {
  return randomBytes(32).toString('hex');
}

// The shopper's earlier checkout (the site remembers the token returned
// with the last one it started) gets replaced rather than blocking them
// from checking out again. Expiring it first means only the new checkout
// can be paid. A paid one means the piece has sold, even if the webhook
// hasn't landed yet; one paid by a delayed method is still settling.
async function closeReplacedCheckout({ stripeClient, db, now }, sessionId, product) {
  const previous = await stripeClient.checkout.sessions.retrieve(sessionId);
  if (previous.status === 'complete') {
    if (previous.payment_status === 'unpaid') {
      // As the webhook does, in case it hasn't arrived yet.
      await holdForPendingPayment(db, sessionId, now + PENDING_PAYMENT_HOLD_MS);
      throw new CatalogValidationError(
        'PAYMENT_PENDING',
        `A payment for ${product.title} is being processed. If it doesn't go through, it'll be available again.`
      );
    }
    throw new CatalogValidationError('OUT_OF_STOCK', `${product.title} has just sold.`);
  }
  if (previous.status === 'open') {
    await stripeClient.checkout.sessions.expire(sessionId);
  }
}

// Only called once the new session's url will never reach the shopper, so
// a failure here leaves an unreachable session that Stripe expires anyway.
async function expireUnusedCheckout(stripeClient, sessionId) {
  try {
    await stripeClient.checkout.sessions.expire(sessionId);
  } catch (error) {
    logger.warn('Could not expire an unused checkout session:', error.message);
  }
}

/**
 * Testable core — takes its dependencies (Firestore, Stripe client, site
 * origin) as parameters instead of reaching for module-level singletons, so
 * tests can inject fakes without mocking the stripe/firebase-admin modules
 * themselves. The exported onRequest handler below is the only thing that
 * wires in the real dependencies.
 */
async function handleCreateCheckoutSession(
  req,
  res,
  { db, stripeClient, siteOrigin, now = Date.now, newToken = newReplaceToken }
) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // Only the items are read. Stripe's hosted page collects the shopper's
  // email, name, phone and address (and optional special requests), so any
  // customer details an older client still sends are ignored.
  const { items, replaceToken } = req.body || {};
  // Only a hint: anything that isn't a token this function issued is ignored.
  const replaceTokenHash =
    typeof replaceToken === 'string' && REPLACE_TOKEN.test(replaceToken) ? hashToken(replaceToken) : null;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  try {
    // Before any Firestore read, so an oversized or duplicated list is
    // rejected without one product read per entry.
    validateItemList(items);

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

    // Checked before calling Stripe so a held piece costs no Stripe session;
    // reservePieces below re-checks inside a transaction.
    const startedAt = now();
    const uniqueSkus = items.map((item) => item.sku).filter((sku) => isOneOfAKind(catalog.get(sku)));
    if (uniqueSkus.length > 0) {
      const holds = await readHolds(db, uniqueSkus);
      const replacedSessionId = checkHolds(holds, catalog, { now: startedAt, replaceTokenHash });
      if (replacedSessionId) {
        const replacedSku = uniqueSkus.find((sku) => holds.get(sku)?.sessionId === replacedSessionId);
        await closeReplacedCheckout(
          { stripeClient, db, now: startedAt },
          replacedSessionId,
          catalog.get(replacedSku)
        );
      }
    }

    const expiresAt = Math.floor(startedAt / 1000) + CHECKOUT_LIFETIME_SECONDS;
    const session = await stripeClient.checkout.sessions.create({
      mode: 'payment',
      expires_at: expiresAt,
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: ['US'] },
      phone_number_collection: { enabled: true },
      custom_fields: [
        {
          key: 'notes',
          label: { type: 'custom', custom: 'Special requests' },
          type: 'text',
          optional: true,
          // Stripe rejects a maximum_length above 255.
          text: { maximum_length: 255 },
        },
      ],
      success_url: `${siteOrigin}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteOrigin}/order/cancelled`,
    });

    const token = newToken();
    if (uniqueSkus.length > 0) {
      try {
        await reservePieces(db, {
          skus: uniqueSkus,
          sessionId: session.id,
          heldUntil: expiresAt * 1000 + HOLD_GRACE_MS,
          tokenHash: hashToken(token),
          now: startedAt,
          replaceTokenHash,
          catalog,
        });
      } catch (error) {
        await expireUnusedCheckout(stripeClient, session.id);
        throw error;
      }
    }

    // The id lets the site's success page confirm it was this checkout
    // (Stripe adds it to success_url as session_id) before touching the cart.
    // replaceToken lets this browser replace this checkout later.
    return res.status(200).json({ url: session.url, id: session.id, replaceToken: token });
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      const status = error.code === 'RESERVED' || error.code === 'PAYMENT_PENDING' ? 409 : 400;
      return res.status(status).json({ error: error.message, code: error.code });
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
