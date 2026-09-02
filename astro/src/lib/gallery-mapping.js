// Pure Firestore-doc -> GalleryPhoto transform, shared by both the
// build-time snapshot script (scripts/fetch-gallery.mjs) and the live
// Firestore reads used by gallery.astro (see gallery-live.js). Same
// extraction rationale as product-mapping.js.

/**
 * Firestore data isn't a trusted input, and both imageUrl and link get
 * rendered directly into HTML attributes (<img src>, <a href>) on the
 * gallery page — an unvalidated javascript:/data:/vbscript: URL landing in
 * either would be an XSS vector. Only http(s) URLs pass through; anything
 * else falls back to `whenInvalid`.
 * @param {unknown} url
 * @param {T} whenInvalid
 * @returns {string | T}
 * @template T
 */
function sanitizeHttpUrl(url, whenInvalid) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return whenInvalid;
  return url;
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
    // Falls back to '' (not null) on an invalid/missing value — src is
    // typed as a plain string, never nullable, unlike link below.
    src: sanitizeHttpUrl(data.imageUrl, ''),
    alt: data.altText || '',
    caption: data.caption || null,
    link: sanitizeHttpUrl(data.link, null),
  };
}
