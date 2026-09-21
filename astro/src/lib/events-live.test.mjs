import { describe, it, expect } from 'vitest';
import { fetchLiveEvents } from './events-live.js';

// Same fake-Firestore shape as products-live.test.mjs/gallery-live.test.mjs —
// no real Firestore/network involved, per QS5.
function fakeDb(docs) {
  return {
    collection(name) {
      if (name !== 'events') throw new Error(`unexpected collection: ${name}`);
      return {
        where(field, op, value) {
          if (field !== 'isActive' || op !== '==' || value !== true) {
            throw new Error(`unexpected where clause: ${field} ${op} ${value}`);
          }
          return {
            async get() {
              return {
                docs: docs
                  .filter((d) => d.data().isActive === true)
                  .map((d) => ({ id: d.id, data: d.data })),
              };
            },
          };
        },
      };
    },
  };
}

function fakeTimestamp(dateString) {
  const date = new Date(dateString);
  return { toDate: () => date };
}

function fakeDoc(id, data) {
  return { id, data: () => data };
}

describe('fetchLiveEvents', () => {
  it('maps active Firestore event docs into SiteEvents', async () => {
    const db = fakeDb([
      fakeDoc('abc', { title: 'Mezcala', eventDate: fakeTimestamp('2026-08-22'), isActive: true }),
    ]);

    const events = await fetchLiveEvents(db);

    expect(events).toEqual([expect.objectContaining({ id: 'abc', title: 'Mezcala' })]);
  });

  it('queries only isActive events via the where clause rather than filtering client-side', async () => {
    const db = fakeDb([
      fakeDoc('abc', { title: 'Active', eventDate: fakeTimestamp('2026-08-22'), isActive: true }),
    ]);

    await expect(fetchLiveEvents(db)).resolves.toEqual([expect.objectContaining({ id: 'abc' })]);
  });

  it('excludes docs with no valid eventDate instead of surfacing them as always-shown recurring events', async () => {
    const db = fakeDb([
      fakeDoc('good', { title: 'Has a date', eventDate: fakeTimestamp('2026-08-22'), isActive: true }),
      fakeDoc('bad', { title: 'No date field', isActive: true }),
    ]);

    const events = await fetchLiveEvents(db);

    expect(events.map((e) => e.id)).toEqual(['good']);
  });

  it('returns an empty array when there are no active events', async () => {
    const db = fakeDb([]);

    const events = await fetchLiveEvents(db);

    expect(events).toEqual([]);
  });
});
