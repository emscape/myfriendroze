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

  return snapshot.docs.map(docToGalleryPhoto);
}
