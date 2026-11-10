import { describe, it, expect } from 'vitest';
import { fetchReservedProducts } from './reservations-live.js';

const CODE = 'Ab3_-xYz0123456789';

function productDoc(id, data) {
  return { id, data: () => ({ isActive: true, price: 40, category: 'pottery', ...data }) };
}

// Minimal fake of the reads fetchReservedProducts makes: one reservation
// doc get, and the isActive products query (same shape as products-live).
function fakeDb({ reservations = {}, products = [] }) {
  const reads = [];
  return {
    reads,
    collection(name) {
      if (name === 'reservations') {
        return {
          doc: (id) => ({
            async get() {
              reads.push(`reservations/${id}`);
              return { exists: id in reservations, data: () => reservations[id] };
            },
          }),
        };
      }
      if (name === 'products') {
        return {
          where: () => ({
            async get() {
              reads.push('products');
              return { docs: products.filter((d) => d.data().isActive === true) };
            },
          }),
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
}

describe('fetchReservedProducts', () => {
  it("returns the reservation's active pieces, in the order Roze listed them", async () => {
    const db = fakeDb({
      reservations: { [CODE]: { note: 'Sam from the market', productIds: ['vase', 'bowl', 'gone'] } },
      products: [
        productDoc('bowl', { title: 'Blue Bowl', reserved: true }),
        productDoc('vase', { title: 'Tall Vase', reserved: true }),
        productDoc('mug', { title: 'Mug' }),
      ],
    });

    const result = await fetchReservedProducts(db, CODE);

    expect(result.map((p) => p.id)).toEqual(['vase', 'bowl']);
    expect(result[0]).toMatchObject({ title: 'Tall Vase', reserved: true });
  });

  // The note is Roze's private reminder of who the pieces are for.
  it('never returns the private note', async () => {
    const db = fakeDb({
      reservations: { [CODE]: { note: 'Sam from the market', productIds: ['bowl'] } },
      products: [productDoc('bowl', { title: 'Blue Bowl', reserved: true })],
    });

    const result = await fetchReservedProducts(db, CODE);

    expect(JSON.stringify(result)).not.toContain('Sam from the market');
  });

  it('returns null for a malformed code without reading Firestore', async () => {
    const db = fakeDb({});
    expect(await fetchReservedProducts(db, 'short')).toBeNull();
    expect(await fetchReservedProducts(db, undefined)).toBeNull();
    expect(db.reads).toEqual([]);
  });

  it('returns null when the reservation does not exist, without reading products', async () => {
    const db = fakeDb({});
    expect(await fetchReservedProducts(db, CODE)).toBeNull();
    expect(db.reads).toEqual([`reservations/${CODE}`]);
  });

  it('returns an empty list for a reservation with no usable productIds', async () => {
    const db = fakeDb({ reservations: { [CODE]: { note: 'x' } }, products: [productDoc('bowl', { title: 'B' })] });
    expect(await fetchReservedProducts(db, CODE)).toEqual([]);
  });
});
