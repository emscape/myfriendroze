// Pure Firestore-doc -> GalleryPhoto transform, shared by both the
// build-time snapshot script (scripts/fetch-gallery.mjs) and the live
// Firestore reads used by gallery.astro (see gallery-live.js). Same
// extraction rationale as product-mapping.js.

import { sanitizeHttpUrl } from './url-sanitize.js';

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
    // `|| ''`/`|| null` alone only replace *falsy* values — a non-string
    // truthy value (a stray number, object, array from bad Firestore
    // data) would otherwise pass straight through and violate the
    // declared string/string|null shape. typeof-guard first.
    alt: typeof data.altText === 'string' ? data.altText : '',
    caption: typeof data.caption === 'string' ? data.caption : null,
    link: sanitizeHttpUrl(data.link, null),
  };
}
