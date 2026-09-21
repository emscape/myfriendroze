import { describe, it, expect } from 'vitest';
import { events, getUpcomingEvents } from './events.js';

describe('events (hardcoded recurring extras)', () => {
  it('keeps only null-date recurring entries — anything date-bound belongs in Firestore now', () => {
    for (const event of events) {
      expect(event.startDate).toBeNull();
      expect(event.endDate).toBeNull();
    }
  });
});

describe('getUpcomingEvents', () => {
  const today = new Date('2026-09-21');

  it('keeps a recurring event with no end date regardless of the reference date', () => {
    const recurring = { id: 'r', title: 'Recurring', endDate: null };

    expect(getUpcomingEvents([recurring], today)).toEqual([recurring]);
  });

  it('drops an event whose endDate is before the reference date', () => {
    const past = { id: 'past', title: 'Past', endDate: new Date('2026-09-20') };

    expect(getUpcomingEvents([past], today)).toEqual([]);
  });

  it('keeps an event whose endDate is on or after the reference date', () => {
    const upcoming = { id: 'upcoming', title: 'Upcoming', endDate: new Date('2026-09-21') };

    expect(getUpcomingEvents([upcoming], today)).toEqual([upcoming]);
  });

  it('preserves input order so hardcoded extras placed first stay first', () => {
    const first = { id: 'first', title: 'First', endDate: null };
    const second = { id: 'second', title: 'Second', endDate: new Date('2026-10-01') };

    expect(getUpcomingEvents([first, second], today)).toEqual([first, second]);
  });
});
