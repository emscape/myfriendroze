// Pure Firestore-doc -> GalleryPhoto transform, shared by both the
// build-time snapshot script (scripts/fetch-gallery.mjs) and the live
// Firestore reads used by gallery.astro (see gallery-live.js). Same
// extraction rationale as product-mapping.js.

/**
 * Pure transform from a Firestore gallery document to the shape
 * astro/src/data/gallery.js's GalleryPhoto typedef expects. No Firestore
 * calls here — this is what makes it unit-testable without a live/emulated
 * database.
 * @param {{ id: string, data: () => Record<string, any> }} doc
 * @returns {{ id: string, src: string, alt: string, caption: string|null, link: string|null }}
 */
export function docToGalleryPhoto(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    src: data.imageUrl,
    alt: data.altText || '',
    caption: data.caption || null,
    link: data.link || null,
  };
}
