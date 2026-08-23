// Upcoming and recurring events for myfriendroze & d.d. succulents
// Add new events here; past events are automatically hidden on the site.

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
    link: 'https://www.facebook.com/myfriendrozeceramics',
    linkLabel: 'Join us there to participate!',
    location: null,
    // null date = recurring / no expiry, always shown
    startDate: null,
    endDate: null,
  },
  {
    id: 'mezcala-2026',
    title: 'Mezcala',
    description: '9a - 2p',
    link: null,
    linkLabel: null,
    location: '6901 Orange Ave, Long Beach, CA',
    startDate: new Date('2026-08-22'),
    endDate: new Date('2026-08-22'),
  },
  {
    id: 'prickly-monster-cactus-succulent-festival-2026',
    title: 'Prickly Monster Cactus & Succulent Festival',
    description: '12p - 5p, at Common Space Brewing',
    link: null,
    linkLabel: null,
    location: '3411 El Segundo Blvd, Hawthorne, CA',
    startDate: new Date('2026-09-06'),
    endDate: new Date('2026-09-06'),
  },
  {
    id: 'pasadena-artwalk-2026',
    title: 'Pasadena Artwalk',
    description: '11a - 6p',
    link: null,
    linkLabel: null,
    location: 'Green St, Pasadena CA - Between Los Robles & El Molino',
    startDate: new Date('2026-09-19'),
    endDate: new Date('2026-09-20'),
  },
];

/** @returns {SiteEvent[]} */
export function getUpcomingEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return events.filter(e => e.endDate === null || e.endDate >= today);
}
