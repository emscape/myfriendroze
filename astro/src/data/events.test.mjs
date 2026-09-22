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

  // The two cases below use explicit UTC instants (not local-time-parsed
  // strings) chosen so a naive local-runtime "today" boundary disagrees
  // with the venue's actual (Pacific) calendar day — same rationale as
  // event-schedule.test.mjs. Reproduces the PR #36 review follow-up: this
  // filter must agree with event-schedule.js about what "today" means, or
  // an event can display as still-current while already having been
  // dropped from the list (or the reverse).
  it('drops an event that ended late last night Pacific time, even during the early UTC morning hours that still count as "today" naively', () => {
    const referenceDate = new Date('2026-09-21T09:00:00Z'); // 2:00 AM PDT, Sept 21
    // 11:00 PM PDT, Sept 20 — Pacific-yesterday, even though its UTC
    // instant (06:00Z) falls on the same UTC calendar day as referenceDate.
    const endedLateLastNightPacific = {
      id: 'late',
      title: 'Ended late last night Pacific',
      endDate: new Date('2026-09-21T06:00:00Z'),
    };

    expect(getUpcomingEvents([endedLateLastNightPacific], referenceDate)).toEqual([]);
  });

  it('keeps an event still within the current Pacific day during those same early UTC morning hours', () => {
    const referenceDate = new Date('2026-09-21T09:00:00Z'); // 2:00 AM PDT, Sept 21
    const stillPacificToday = {
      id: 'today',
      title: 'Still Pacific-today',
      endDate: new Date('2026-09-21T08:00:00Z'), // 1:00 AM PDT, Sept 21
    };

    expect(getUpcomingEvents([stillPacificToday], referenceDate)).toEqual([stillPacificToday]);
  });
});
