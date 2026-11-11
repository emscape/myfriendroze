// Live read for the /reserved/<code> page: the pieces Roze has reserved for
// one customer (reservations/{code}, written by the admin app — see
// firebase/functions/lib/reservations.js). Only the products are returned;
// the reservation's note is Roze's private reminder and never leaves here.
//
// db is injected, same as products-live.js, so tests use a fake (QS5).

import { fetchLiveProducts } from './products-live.js';
import { isReservationCode } from './reservation-code.js';

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {unknown} code from the URL, untrusted
 * @returns {Promise<Awaited<ReturnType<typeof fetchLiveProducts>> | null>}
 *   the reserved pieces still on the site, in the reservation's order, or
 *   null when there is no such reservation
 */
export async function fetchReservedProducts(db, code) {
  if (!isReservationCode(code)) return null;
  const reservation = await db.collection('reservations').doc(code).get();
  if (!reservation.exists) return null;

  const { productIds } = reservation.data();
  if (!Array.isArray(productIds) || productIds.length === 0) return [];
  const byId = new Map((await fetchLiveProducts(db)).map((product) => [product.id, product]));
  return productIds.map((id) => byId.get(id)).filter(Boolean);
}
