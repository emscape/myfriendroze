// Hardcoded recurring/no-date event extras for myfriendroze — things that
// don't fit the Firestore-backed Event model the admin app manages (see
// astro/src/lib/events-live.js), namely a standing recurring listing with
// no specific date. Dated, one-off events belong in the admin app now, not
// here — see events.astro, which merges this list with the live Firestore
// events before filtering to what's upcoming.

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   description: string|null,
 *   link: string|null,
 *   linkLabel: string|null,
 *   location: string|null,
 *   startDate: Date|null,
 *   endDate: Date|null
 * }} SiteEvent
 */

/** @type {SiteEvent[]} */
export const events = [
  {
    id: 'facebook-sunday-sale',
    title: 'Every Sunday 11am Sale in Plant Killers Purge on Facebook',
    description: null,
    link: 'https://www.facebook.com/groups/plantkillers',
    linkLabel: 'Join us there to participate!',
    location: null,
    // null date = recurring / no expiry, always shown
    startDate: null,
    endDate: null,
  },
];

/**
 * Filters a list of SiteEvents down to ones still worth showing: a null
 * endDate is a recurring/no-expiry entry (always kept), otherwise the event
 * is kept through the end of its endDate day.
 * @param {SiteEvent[]} eventList
 * @param {Date} [referenceDate]
 * @returns {SiteEvent[]}
 */
export function getUpcomingEvents(eventList, referenceDate = new Date()) {
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);
  return eventList.filter((e) => e.endDate === null || e.endDate >= today);
}
