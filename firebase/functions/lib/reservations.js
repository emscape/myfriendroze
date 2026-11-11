// Pieces Roze has reserved for one customer. The admin app writes
// reservations/{code}: { note, productIds } (admin-only in firestore.rules,
// so the private note never reaches the public) and sets reserved: true on
// each product, which the shop shows as "Reserved". The customer gets a
// /reserved/<code> link; the code is the only thing that lets a checkout
// buy those pieces (createCheckoutSession.js), so it must be random and
// long enough not to be guessed. stripeWebhook.js takes the pieces out of
// the reservation once they're paid for, and deletes it when it's empty.
//
// Only one-of-a-kind pieces are reserved for now, so a reserved piece is
// also held during checkout like any other (lib/checkoutHolds.js).

const { CatalogValidationError } = require('./pricing');

const RESERVATIONS_COLLECTION = 'reservations';
// URL-safe so it can sit in the /reserved/<code> path, and never a slash,
// which would address a different document.
const RESERVATION_CODE = /^[A-Za-z0-9_-]{16,64}$/;

function isReservationCode(code) {
  return typeof code === 'string' && RESERVATION_CODE.test(code);
}

function reservationRef(db, code) {
  return db.collection(RESERVATIONS_COLLECTION).doc(code);
}

function reservedPieceError(product) {
  return new CatalogValidationError('RESERVED_PIECE', `${product.title} is reserved for another customer.`);
}

/**
 * Refuses the checkout unless every reserved piece in it belongs to the
 * reservation the shopper's code names.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string[]} skus
 * @param {Map<string, {title: string, reserved?: boolean}>} catalog
 * @param {unknown} code the reservationCode the client sent, untrusted
 * @returns {Promise<string | null>} the code, when it covered a reserved piece
 * @throws {CatalogValidationError} RESERVED_PIECE
 */
async function checkReservedPieces(db, skus, catalog, code) {
  // The catalog has every sku: buildLineItemsFromCatalog refuses unknown ones.
  const reservedSkus = skus.filter((sku) => catalog.get(sku).reserved === true);
  if (reservedSkus.length === 0) return null;
  if (!isReservationCode(code)) throw reservedPieceError(catalog.get(reservedSkus[0]));

  const reservation = await reservationRef(db, code).get();
  const productIds = reservation.exists ? reservation.data().productIds : null;
  const covered = new Set(Array.isArray(productIds) ? productIds : []);
  const uncovered = reservedSkus.find((sku) => !covered.has(sku));
  if (uncovered) throw reservedPieceError(catalog.get(uncovered));
  return code;
}

/**
 * The read half of updating a paid checkout's reservation, for use inside
 * the caller's transaction before any of its writes: the reservation, and
 * the bought products it lists.
 *
 * @param {FirebaseFirestore.Transaction} tx
 * @param {FirebaseFirestore.Firestore} db
 * @param {unknown} code from the Stripe session's metadata
 * @param {Iterable<string>} soldSkus
 */
async function readReservation(tx, db, code, soldSkus) {
  if (!isReservationCode(code)) return null;
  const reservation = await tx.get(reservationRef(db, code));
  if (!reservation.exists) return null;

  const { productIds: stored } = reservation.data();
  const productIds = Array.isArray(stored) ? stored : [];
  const sold = new Set(soldSkus);
  const soldIds = productIds.filter((sku) => sold.has(sku));
  const products = await Promise.all(soldIds.map((sku) => tx.get(db.collection('products').doc(sku))));
  return { reservation, remaining: productIds.filter((sku) => !sold.has(sku)), products };
}

/**
 * The write half: clears reserved on the bought pieces and takes them out
 * of the reservation, deleting it once none are left. A product deleted in
 * the meantime is skipped rather than recreated.
 *
 * @param {FirebaseFirestore.Transaction} tx
 * @param {Awaited<ReturnType<typeof readReservation>>} read
 */
function writeReservationSold(tx, read) {
  if (!read || read.products.length === 0) return;
  read.products.forEach((product) => {
    if (product.exists) tx.update(product.ref, { reserved: false });
  });
  if (read.remaining.length === 0) {
    tx.delete(read.reservation.ref);
  } else {
    tx.update(read.reservation.ref, { productIds: read.remaining });
  }
}

module.exports = { isReservationCode, checkReservedPieces, readReservation, writeReservationSold };
