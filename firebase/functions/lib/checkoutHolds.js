// Holds on one-of-a-kind pieces while a Stripe checkout is open, so two
// shoppers can't both pay for the same piece. createCheckoutSession.js
// writes the holds; stripeWebhook.js marks the pieces sold when the
// checkout is paid and releases the holds when it expires.
//
// A hold is checkoutHolds/{sku}: { sessionId, heldUntil (epoch ms),
// tokenHash, pendingPayment? }. tokenHash is the SHA-256 of a random token
// returned only to the browser that started the checkout; presenting the
// token is what lets a shopper replace their own checkout. The session id
// is not enough, since it appears in the Stripe checkout page's URL. Holds
// live in their own collection because products are publicly readable
// (firestore.rules); no rule matches this one, so only the Admin SDK can
// read or write it.
//
// Only pieces whose quantity limit is 1 are held. Plants come in
// multiples; their optional stock count is counted down after payment
// instead (lib/stockCounts.js).

const { createHash } = require('node:crypto');
const { CatalogValidationError, maxQtyFor } = require('./pricing');

const HOLDS_COLLECTION = 'checkoutHolds';
// Stripe refuses an expires_at under 30 minutes after creation; the extra
// minute covers the time between computing it and Stripe receiving it.
const CHECKOUT_LIFETIME_SECONDS = 31 * 60;
// A hold outlasts its checkout a little, so a payment that completes right
// at expiry is marked sold before anyone else can hold the piece. Holds
// are normally released earlier, when Stripe reports the expiry.
const HOLD_GRACE_MS = 5 * 60 * 1000;
// A delayed payment method (bank debit) completes the checkout before the
// money arrives; its pieces stay held until Stripe reports the outcome,
// which can take several business days.
const PENDING_PAYMENT_HOLD_MS = 14 * 24 * 60 * 60 * 1000;

function isOneOfAKind(product) {
  return maxQtyFor(product) === 1;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function holdRef(db, sku) {
  return db.collection(HOLDS_COLLECTION).doc(sku);
}

function isActiveHold(hold, now) {
  return !!hold && hold.heldUntil > now;
}

function reservedError(product) {
  return new CatalogValidationError(
    'RESERVED',
    `Someone is checking out ${product.title} right now. If they don't finish, it'll be available again in about half an hour.`
  );
}

function paymentPendingError(product) {
  return new CatalogValidationError(
    'PAYMENT_PENDING',
    `A payment for ${product.title} is being processed. If it doesn't go through, it'll be available again.`
  );
}

function soldError(product) {
  return new CatalogValidationError('OUT_OF_STOCK', `${product.title} has just sold.`);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string[]} skus
 * @returns {Promise<Map<string, object>>} holds by sku
 */
async function readHolds(db, skus) {
  const snaps = await Promise.all(skus.map((sku) => holdRef(db, sku).get()));
  const holds = new Map();
  snaps.forEach((snap, i) => {
    if (snap.exists) holds.set(skus[i], snap.data());
  });
  return holds;
}

/**
 * Refuses if any piece is held by a checkout other than the shopper's own
 * (the one whose token hashes to replaceTokenHash).
 *
 * @param {Map<string, {sessionId: string, heldUntil: number, tokenHash?: string, pendingPayment?: boolean}>} holds
 * @param {Map<string, {title: string}>} catalog
 * @param {{now: number, replaceTokenHash: string | null}} options
 * @returns {string | null} the shopper's own checkout still holding a piece, if any
 * @throws {CatalogValidationError} RESERVED or PAYMENT_PENDING
 */
function checkHolds(holds, catalog, { now, replaceTokenHash }) {
  let replacedSessionId = null;
  for (const [sku, hold] of holds) {
    if (!isActiveHold(hold, now)) continue;
    if (hold.pendingPayment) throw paymentPendingError(catalog.get(sku));
    if (replaceTokenHash && hold.tokenHash === replaceTokenHash) {
      replacedSessionId = hold.sessionId;
    } else {
      throw reservedError(catalog.get(sku));
    }
  }
  return replacedSessionId;
}

/**
 * Holds every piece for sessionId in one transaction, or none of them. The
 * products are re-read too, since one may have sold since the caller's read.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{skus: string[], sessionId: string, heldUntil: number, tokenHash: string, now: number,
 *   replaceTokenHash: string | null, catalog: Map<string, {title: string}>}} options
 * @throws {CatalogValidationError} RESERVED, PAYMENT_PENDING or OUT_OF_STOCK
 */
async function reservePieces(db, { skus, sessionId, heldUntil, tokenHash, now, replaceTokenHash, catalog }) {
  await db.runTransaction(async (tx) => {
    const products = await Promise.all(skus.map((sku) => tx.get(db.collection('products').doc(sku))));
    const holdSnaps = await Promise.all(skus.map((sku) => tx.get(holdRef(db, sku))));

    skus.forEach((sku, i) => {
      if (!products[i].exists || products[i].data().inStock === false) {
        throw soldError(catalog.get(sku));
      }
    });
    const holds = new Map();
    holdSnaps.forEach((snap, i) => {
      if (snap.exists) holds.set(skus[i], snap.data());
    });
    checkHolds(holds, catalog, { now, replaceTokenHash });

    for (const sku of skus) {
      tx.set(holdRef(db, sku), { sessionId, heldUntil, tokenHash });
    }
  });
}

/**
 * Deletes sessionId's holds. Transactional, so a hold another checkout
 * has just taken over is never deleted.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} sessionId
 */
async function releaseHolds(db, sessionId) {
  await db.runTransaction(async (tx) => {
    const held = await tx.get(db.collection(HOLDS_COLLECTION).where('sessionId', '==', sessionId));
    held.docs.forEach((doc) => tx.delete(doc.ref));
  });
}

/**
 * Keeps sessionId's holds until heldUntil while its delayed payment
 * settles, marked so other shoppers are told a payment is processing.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} sessionId
 * @param {number} heldUntil epoch ms
 */
async function holdForPendingPayment(db, sessionId, heldUntil) {
  await db.runTransaction(async (tx) => {
    const held = await tx.get(db.collection(HOLDS_COLLECTION).where('sessionId', '==', sessionId));
    held.docs.forEach((doc) => tx.update(doc.ref, { heldUntil, pendingPayment: true }));
  });
}

/**
 * The read half of marking a paid checkout's pieces sold, for use inside
 * the caller's transaction before any of its writes.
 *
 * @param {FirebaseFirestore.Transaction} tx
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} sessionId
 */
async function readSessionHolds(tx, db, sessionId) {
  const held = await tx.get(db.collection(HOLDS_COLLECTION).where('sessionId', '==', sessionId));
  const products = await Promise.all(held.docs.map((doc) => tx.get(db.collection('products').doc(doc.id))));
  return { holds: held.docs, products };
}

/**
 * The write half: marks each held piece sold and deletes the holds. A
 * product deleted in the meantime is skipped rather than recreated.
 *
 * @param {FirebaseFirestore.Transaction} tx
 * @param {Awaited<ReturnType<typeof readSessionHolds>>} read
 */
function writePiecesSold(tx, { holds, products }) {
  products.forEach((product) => {
    if (product.exists) tx.update(product.ref, { inStock: false });
  });
  holds.forEach((hold) => tx.delete(hold.ref));
}

module.exports = {
  isOneOfAKind,
  readHolds,
  checkHolds,
  reservePieces,
  releaseHolds,
  holdForPendingPayment,
  hashToken,
  readSessionHolds,
  writePiecesSold,
  CHECKOUT_LIFETIME_SECONDS,
  HOLD_GRACE_MS,
  PENDING_PAYMENT_HOLD_MS,
};
