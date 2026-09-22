import { describe, it, expect } from 'vitest';
import { toEventCalendarDayKey } from './event-timezone.js';

describe('toEventCalendarDayKey', () => {
  it('keys a UTC instant by its Pacific calendar day, not its UTC calendar day', () => {
    // 11:00 PM PDT, Sept 20 — already Sept 21 in UTC.
    expect(toEventCalendarDayKey(new Date('2026-09-21T06:00:00Z'))).toBe('2026-09-20');
  });

  it('keys an early-Pacific-morning instant to the correct Pacific day', () => {
    // 1:00 AM PDT, Sept 21.
    expect(toEventCalendarDayKey(new Date('2026-09-21T08:00:00Z'))).toBe('2026-09-21');
  });
});
