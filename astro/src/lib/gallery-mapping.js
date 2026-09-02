// Pure Firestore-doc -> GalleryPhoto transform, shared by both the
// build-time snapshot script (scripts/fetch-gallery.mjs) and the live
// Firestore reads used by gallery.astro (see gallery-live.js). Same
// extraction rationale as product-mapping.js.

/**
 * Firestore data isn't a trusted input, and this value gets rendered
 * directly into an <a href> on the gallery page — an unvalidated
 * javascript:/data:/vbscript: URL landing there would be an XSS vector on
 * click. Only http(s) links pass through; anything else maps to null (the
 * same "no link" value already used when the field is absent).
 * @param {unknown} link
 * @returns {string|null}
 */
function sanitizeLink(link) {
  if (typeof link !== 'string') return null;
  return /^https?:\/\//i.test(link) ? link : null;
}

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
    link: sanitizeLink(data.link),
  };
}
