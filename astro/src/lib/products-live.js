// Live (per-request) Firestore product reads for shop.astro and
// products/[handle].astro, replacing the build-time syncedProducts.js
// snapshot those pages used to read. Firestore is now the single source of
// truth checked on every request — no rebuild/deploy needed for an admin
// app price/availability edit to show up on the live site (see backlog:
// the druzy-wood-pot $10-vs-$1000 incident this fixes).
//
// db is an injected dependency (same DI pattern as
// firebase/functions/lib/pricing.js and createCheckoutSession.js) so this
// is unit-testable with a fake Firestore, never a live one (QS5).

import { docToProduct, dedupeHandles } from './product-mapping.js';

/**
 * @param {FirebaseFirestore.Firestore} db
 * @returns {Promise<ReturnType<typeof docToProduct>[]>}
 */
export async function fetchLiveProducts(db) {
  const snapshot = await db
    .collection('products')
    .where('isActive', '==', true)
    .get();

  return dedupeHandles(snapshot.docs.map(docToProduct));
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} handle
 * @returns {Promise<ReturnType<typeof docToProduct> | null>}
 */
export async function fetchLiveProductByHandle(db, handle) {
  // Skip the Firestore read entirely for a missing/empty handle (e.g. a
  // malformed request) instead of fetching and mapping the whole active
  // catalog just to fail to match anything.
  if (!handle) return null;
  const products = await fetchLiveProducts(db);
  return products.find((p) => p.handle === handle) || null;
}
