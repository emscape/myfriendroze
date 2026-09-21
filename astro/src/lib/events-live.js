// Live (per-request) Firestore event reads for events.astro. Before this,
// events.astro read a hand-maintained static array
// (astro/src/data/events.js) that only a developer could edit, and that
// array's own past-event filter only ever re-ran at build time — so an
// event stayed listed as "upcoming" on the live site until the next
// deploy, even after it had already happened (see the Pasadena Artwalk
// staleness report this fixes). Reading Firestore on every request, same
// DI pattern as products-live.js/gallery-live.js, fixes both: the admin
// app is now the source of truth, and "is this event still upcoming" is
// evaluated against the real current date on every page view.

import { docToEvent } from './event-mapping.js';

/**
 * @param {FirebaseFirestore.Firestore} db
 * @returns {Promise<ReturnType<typeof docToEvent>[]>}
 */
export async function fetchLiveEvents(db) {
  const snapshot = await db.collection('events').where('isActive', '==', true).get();

  // A doc with no valid eventDate maps to a null startDate/endDate, which
  // getUpcomingEvents would otherwise treat as a recurring, always-shown
  // event — exclude it here instead.
  return snapshot.docs.map(docToEvent).filter((event) => event.startDate !== null);
}
