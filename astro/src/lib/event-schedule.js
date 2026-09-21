// Pure date/time formatting for events.astro's schedule display. Split out
// from the template so it's unit-testable — the same reason
// product-mapping.js/gallery-mapping.js live outside their .astro pages.

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

function isSameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Formats a SiteEvent's startDate/endDate into a human schedule string:
 *   - "9/6/2026, 12:00 PM – 5:00 PM" for a same-day event with an end time
 *   - "9/19/2026, 11:00 AM – 9/20/2026, 6:00 PM" for a multi-day event
 *   - "9/6/2026, 12:00 PM" when there's no distinct end time
 *   - "" for a recurring/no-date entry (startDate null)
 * @param {Date | null} startDate
 * @param {Date | null} endDate
 * @returns {string}
 */
export function formatEventSchedule(startDate, endDate) {
  if (!startDate) return '';

  const hasDistinctEnd = endDate && endDate.getTime() !== startDate.getTime();
  if (!hasDistinctEnd) {
    return `${dateFormatter.format(startDate)}, ${timeFormatter.format(startDate)}`;
  }

  if (isSameCalendarDay(startDate, endDate)) {
    return `${dateFormatter.format(startDate)}, ${timeFormatter.format(startDate)} – ${timeFormatter.format(endDate)}`;
  }

  return `${dateFormatter.format(startDate)}, ${timeFormatter.format(startDate)} – ${dateFormatter.format(endDate)}, ${timeFormatter.format(endDate)}`;
}
