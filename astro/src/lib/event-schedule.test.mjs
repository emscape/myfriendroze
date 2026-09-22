import { describe, it, expect } from 'vitest';
import { formatEventSchedule } from './event-schedule.js';

// Fixtures are UTC instants (explicit Z), not local-time-parsed strings —
// this is deliberate: the SSR Cloud Function this runs in defaults to UTC,
// not America/Los_Angeles, so a test built on locally-parsed "wall clock"
// strings would pass on a Pacific-time dev machine while masking a real
// mis-formatting bug in production. Every fixture below is chosen to cross
// a UTC calendar-day boundary that Pacific time does NOT cross (or vice
// versa), so a formatter that forgets the explicit venue timezone fails
// these even locally.
describe('formatEventSchedule', () => {
  it('returns an empty string for a recurring event with no startDate', () => {
    expect(formatEventSchedule(null, null)).toBe('');
  });

  it('formats a same-day (Pacific) event as one date with a start-end time range, even though the times cross a UTC day boundary', () => {
    const start = new Date('2026-09-06T19:00:00Z'); // 12:00 PM PDT, Sept 6
    const end = new Date('2026-09-07T00:00:00Z'); // 5:00 PM PDT, still Sept 6 — but already Sept 7 in UTC
    const result = formatEventSchedule(start, end);

    expect(result).toBe('9/6/2026, 12:00 PM – 5:00 PM');
  });

  it('formats a multi-day (Pacific) event with both dates and both times', () => {
    const start = new Date('2026-09-19T18:00:00Z'); // 11:00 AM PDT, Sept 19
    const end = new Date('2026-09-21T01:00:00Z'); // 6:00 PM PDT, Sept 20 — but Sept 21 in UTC
    const result = formatEventSchedule(start, end);

    expect(result).toBe('9/19/2026, 11:00 AM – 9/20/2026, 6:00 PM');
  });

  it('shows just the start date and time when there is no endDate at all', () => {
    const start = new Date('2026-09-06T19:00:00Z'); // 12:00 PM PDT, Sept 6
    const result = formatEventSchedule(start, null);

    expect(result).toBe('9/6/2026, 12:00 PM');
  });

  it('treats an endDate identical to startDate the same as no end time (avoids a pointless "12:00 PM – 12:00 PM")', () => {
    const sameInstant = new Date('2026-09-06T19:00:00Z');
    const result = formatEventSchedule(sameInstant, new Date(sameInstant));

    expect(result).toBe('9/6/2026, 12:00 PM');
  });
});
