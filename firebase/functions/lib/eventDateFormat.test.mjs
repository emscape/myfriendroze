import { describe, it, expect } from 'vitest';
import { formatEventDateTime } from './eventDateFormat.js';

// Firestore Timestamps expose .toDate() -- these fakes mimic just enough of
// that surface for the function under test, without pulling in the real
// firebase-admin SDK for a pure formatting helper.
function ts(date) {
  return { toDate: () => date };
}

describe('formatEventDateTime', () => {
  it('formats a single-day event with just a start time', () => {
    // 2026-10-03 18:00 America/Los_Angeles == 2026-10-04 01:00 UTC (PDT, UTC-7)
    const result = formatEventDateTime(ts(new Date('2026-10-04T01:00:00Z')), null);

    expect(result.dateText).toBe('Saturday, October 3, 2026');
    expect(result.timeText).toBe('6:00 PM');
  });

  it('formats a same-day event with a distinct end time as a time range', () => {
    const start = ts(new Date('2026-10-04T01:00:00Z')); // 6:00 PM PDT
    const end = ts(new Date('2026-10-04T04:00:00Z')); // 9:00 PM PDT

    const result = formatEventDateTime(start, end);

    expect(result.dateText).toBe('Saturday, October 3, 2026');
    expect(result.timeText).toBe('6:00 PM – 9:00 PM');
  });

  it('formats a multi-day event as a date range with a start time', () => {
    const start = ts(new Date('2026-10-04T01:00:00Z')); // Oct 3, 6:00 PM PDT
    const end = ts(new Date('2026-10-05T20:00:00Z')); // Oct 5, 1:00 PM PDT

    const result = formatEventDateTime(start, end);

    expect(result.dateText).toBe('Saturday, October 3, 2026 – Monday, October 5, 2026');
    expect(result.timeText).toBe('Starts 6:00 PM');
  });

  it('treats an endDate equal to the start as single-day (matches the admin app\'s hasDistinctEndDate check)', () => {
    const start = ts(new Date('2026-10-04T01:00:00Z'));
    const end = ts(new Date('2026-10-04T01:00:00Z'));

    const result = formatEventDateTime(start, end);

    expect(result.timeText).toBe('6:00 PM');
  });

  it('returns empty strings when eventDate is missing', () => {
    const result = formatEventDateTime(null, null);

    expect(result).toEqual({ dateText: '', timeText: '' });
  });
});
