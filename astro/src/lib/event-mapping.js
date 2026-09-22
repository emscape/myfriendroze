// Pure Firestore-doc -> SiteEvent transform, used by the live Firestore
// reads on events.astro (see events-live.js). Same extraction rationale as
// product-mapping.js/gallery-mapping.js: no Firestore calls here, so this is
// unit-testable without a live database.

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function toDate(value) {
  return value && typeof value.toDate === 'function' ? value.toDate() : null;
}

/**
 * Pure transform from a Firestore event document to the shape
 * astro/src/data/events.js's SiteEvent typedef expects.
 *
 * endDate falls back to startDate for single-day events — the Flutter admin
 * app only started collecting a separate end date for multi-day events
 * (like the Pasadena Artwalk) alongside this change, so existing docs
 * without one still map to a correct single-day event instead of null
 * (which would read as "recurring, always shown").
 *
 * A missing/invalid eventDate maps to a null startDate/endDate rather than
 * throwing — fetchLiveEvents filters those out before they'd otherwise be
 * misread as a recurring, always-shown event.
 * @param {{ id: string, data: () => Record<string, any> }} doc
 * @returns {{ id: string, title: string, description: string|null, link: null, linkLabel: null, location: string|null, startDate: Date|null, endDate: Date|null }}
 */
export function docToEvent(doc) {
  const data = doc.data();
  const startDate = toDate(data.eventDate);
  const endDate = toDate(data.endDate) ?? startDate;

  return {
    id: doc.id,
    title: typeof data.title === 'string' ? data.title : '',
    description: typeof data.description === 'string' && data.description !== '' ? data.description : null,
    // The admin app has no concept of an external link for an event today —
    // unlike the hardcoded recurring extras in events.js (e.g. the Facebook
    // sale), which keep that field for their own use.
    link: null,
    linkLabel: null,
    location: typeof data.location === 'string' && data.location !== '' ? data.location : null,
    startDate,
    endDate,
  };
}
