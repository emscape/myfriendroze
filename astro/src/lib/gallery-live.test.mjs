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
                    docs: docs
                      .filter((d) => d.data().isActive !== false)
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
    // fakeDb's where()/orderBy() themselves assert the query shape; a
    // fetchLiveGalleryPhotos that queried differently would throw here.
    const db = fakeDb([fakeDoc('abc', { imageUrl: 'https://example.com/a.jpg', isActive: true })]);

    await expect(fetchLiveGalleryPhotos(db)).resolves.not.toThrow();
  });

  it('returns an empty array when there are no active photos', async () => {
    const db = fakeDb([]);

    const photos = await fetchLiveGalleryPhotos(db);

    expect(photos).toEqual([]);
  });
});
