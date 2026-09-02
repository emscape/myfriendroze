import { describe, it, expect } from 'vitest';
import { fetchLiveGalleryPhotos } from './gallery-live.js';

// Minimal fake Firestore covering the query surface gallery-live.js uses
// (collection().where().orderBy().get()) — no real Firestore/network
// involved, per QS5.
function fakeDb(docs) {
  return {
    collection(name) {
      if (name !== 'gallery') throw new Error(`unexpected collection: ${name}`);
      return {
        where(field, op, value) {
          if (field !== 'isActive' || op !== '==' || value !== true) {
            throw new Error(`unexpected where clause: ${field} ${op} ${value}`);
          }
          return {
            orderBy(field2, direction) {
              if (field2 !== 'createdAt' || direction !== 'desc') {
                throw new Error(`unexpected orderBy: ${field2} ${direction}`);
              }
              return {
                async get() {
                  return {
                    // Real Firestore equality queries only match docs
                    // where the field is literally the given value — a
                    // doc missing isActive entirely would NOT match
                    // `== true` and would be excluded, not included.
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
    },
  };
}

function fakeDoc(id, data) {
  return { id, data: () => data };
}

describe('fetchLiveGalleryPhotos', () => {
  it('maps active Firestore docs into gallery photos', async () => {
    const db = fakeDb([
      fakeDoc('abc', {
        imageUrl: 'https://example.com/a.jpg',
        altText: 'A planter',
        isActive: true,
      }),
    ]);

    const photos = await fetchLiveGalleryPhotos(db);

    expect(photos).toEqual([
      expect.objectContaining({ id: 'abc', src: 'https://example.com/a.jpg', alt: 'A planter' }),
    ]);
  });

  it('queries only isActive photos, ordered newest first, via the where/orderBy clauses rather than client-side filtering', async () => {
    // fakeDb's where()/orderBy() themselves assert the query shape and
    // throw on a mismatch — a fetchLiveGalleryPhotos that queried
    // differently would reject this promise instead of resolving.
    const db = fakeDb([fakeDoc('abc', { imageUrl: 'https://example.com/a.jpg', isActive: true })]);

    await expect(fetchLiveGalleryPhotos(db)).resolves.toEqual([
      expect.objectContaining({ id: 'abc' }),
    ]);
  });

  // docToGalleryPhoto maps an invalid/missing imageUrl to '' rather than
  // throwing (see gallery-mapping.js) — but rendering that as <img src="">
  // triggers an extra request to the current document URL in browsers, so
  // a photo with no real image shouldn't reach the page at all.
  it('filters out photos with no valid imageUrl instead of returning an empty src', async () => {
    const db = fakeDb([
      fakeDoc('good', { imageUrl: 'https://example.com/a.jpg', isActive: true }),
      fakeDoc('bad-url', { imageUrl: 'not-a-url', isActive: true }),
      fakeDoc('missing-url', { isActive: true }),
    ]);

    const photos = await fetchLiveGalleryPhotos(db);

    expect(photos.map((p) => p.id)).toEqual(['good']);
  });

  it('returns an empty array when there are no active photos', async () => {
    const db = fakeDb([]);

    const photos = await fetchLiveGalleryPhotos(db);

    expect(photos).toEqual([]);
  });
});
