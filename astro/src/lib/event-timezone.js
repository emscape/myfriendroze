// Single source of truth for the timezone events are interpreted in — every
// venue this site lists events for is in the LA area, and nothing today
// collects a per-event timezone. Shared by event-schedule.js (display) and
// data/events.js (the upcoming-events filter) so both agree on where a
// calendar day starts and ends; letting them diverge is exactly how an
// event could still be shown on the schedule as "today" while the filter,
// using a different day boundary, had already dropped it (or the reverse) —
// see the PR #36 review follow-up this fixes.

export const EVENT_TIMEZONE = 'America/Los_Angeles';

const calendarDayFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: EVENT_TIMEZONE,
});

/**
 * The event-timezone calendar day a Date falls on, as a sortable/comparable
 * "YYYY-MM-DD" string (en-CA gives that format directly).
 * @param {Date} date
 * @returns {string}
 */
export function toEventCalendarDayKey(date) {
  return calendarDayFormatter.format(date);
}
