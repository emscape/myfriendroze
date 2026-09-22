// Hardcoded recurring/no-date event extras for myfriendroze — things that
// don't fit the Firestore-backed Event model the admin app manages (see
// astro/src/lib/events-live.js), namely a standing recurring listing with
// no specific date. Dated, one-off events belong in the admin app now, not
// here — see events.astro, which merges this list with the live Firestore
// events before filtering to what's upcoming.

import { toEventCalendarDayKey } from '../lib/event-timezone.js';

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   description: string|null,
 *   link: string|null,
 *   linkLabel: string|null,
 *   location: string|null,
 *   imageUrl: string|null,
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
    imageUrl: null,
    // null date = recurring / no expiry, always shown
    startDate: null,
    endDate: null,
  },
];

/**
 * Filters a list of SiteEvents down to ones still worth showing: a null
 * endDate is a recurring/no-expiry entry (always kept), otherwise the event
 * is kept through the end of its endDate day — "day" meaning the venue's
 * timezone (event-timezone.js), not the SSR runtime's (UTC in production).
 * A naive runtime-local cutoff would disagree with event-schedule.js about
 * where a calendar day starts, letting an event drop off several hours
 * before or after the display would suggest it should.
 * @param {SiteEvent[]} eventList
 * @param {Date} [referenceDate]
 * @returns {SiteEvent[]}
 */
export function getUpcomingEvents(eventList, referenceDate = new Date()) {
  const todayKey = toEventCalendarDayKey(referenceDate);
  return eventList.filter((e) => e.endDate === null || toEventCalendarDayKey(e.endDate) >= todayKey);
}
