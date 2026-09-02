// Live (per-request) Firestore gallery reads for gallery.astro, replacing
// the build-time syncedGallery.js snapshot it used to read. Same
// motivation and DI pattern as products-live.js: an admin-app upload
// should appear on the live site immediately, not on the next
// rebuild+deploy.

import { docToGalleryPhoto } from './gallery-mapping.js';

/**
 * @param {FirebaseFirestore.Firestore} db
 * @returns {Promise<ReturnType<typeof docToGalleryPhoto>[]>}
 */
export async function fetchLiveGalleryPhotos(db) {
  const snapshot = await db
    .collection('gallery')
    .where('isActive', '==', true)
    .orderBy('createdAt', 'desc')
    .get();

  // docToGalleryPhoto maps an invalid/missing imageUrl to '' rather than
  // throwing — filter those out here instead of letting them reach the
  // page as <img src="">, which browsers resolve as a request to the
  // current document URL (wasted load, not just a broken image).
  return snapshot.docs.map(docToGalleryPhoto).filter((photo) => photo.src !== '');
}
