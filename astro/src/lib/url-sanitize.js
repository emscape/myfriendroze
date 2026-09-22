// Shared Firestore-data -> safe-URL sanitizer. Firestore data isn't a
// trusted input, and URLs from it get rendered directly into HTML
// attributes (<img src>, <a href>) on gallery.astro and events.astro — an
// unvalidated javascript:/data:/vbscript: URL landing in either would be
// an XSS vector. Only http(s) URLs pass through; anything else falls back
// to `whenInvalid`. Originally lived only in gallery-mapping.js; extracted
// once event-mapping.js needed the exact same check, so the two can't
// drift apart.

/**
 * @param {unknown} url
 * @param {T} whenInvalid
 * @returns {string | T}
 * @template T
 */
export function sanitizeHttpUrl(url, whenInvalid) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return whenInvalid;
  return url;
}
