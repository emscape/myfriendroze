import { describe, it, expect } from 'vitest';
import { formatEventSchedule } from './event-schedule.js';

describe('formatEventSchedule', () => {
  it('returns an empty string for a recurring event with no startDate', () => {
    expect(formatEventSchedule(null, null)).toBe('');
  });

  it('formats a same-day event as one date with a start-end time range', () => {
    const result = formatEventSchedule(
      new Date('2026-09-06T12:00:00'),
      new Date('2026-09-06T17:00:00')
    );

    expect(result).toBe('9/6/2026, 12:00 PM – 5:00 PM');
  });

  it('formats a multi-day event with both dates and both times', () => {
    const result = formatEventSchedule(
      new Date('2026-09-19T11:00:00'),
      new Date('2026-09-20T18:00:00')
    );

    expect(result).toBe('9/19/2026, 11:00 AM – 9/20/2026, 6:00 PM');
  });

  it('shows just the start date and time when there is no endDate at all', () => {
    const result = formatEventSchedule(new Date('2026-09-06T12:00:00'), null);

    expect(result).toBe('9/6/2026, 12:00 PM');
  });

  it('treats an endDate identical to startDate the same as no end time (avoids a pointless "12:00 PM – 12:00 PM")', () => {
    const sameInstant = new Date('2026-09-06T12:00:00');
    const result = formatEventSchedule(sameInstant, new Date(sameInstant));

    expect(result).toBe('9/6/2026, 12:00 PM');
  });
});
