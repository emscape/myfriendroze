import { describe, it, expect } from 'vitest';
import { fetchLiveProducts, fetchLiveProductByHandle } from './products-live.js';

// Same fake-Firestore shape as fetch-products.test.mjs's fakeDoc, wired up
// as a minimal fake `db` with just the query surface these functions use
// (collection().where().get()) — no real Firestore/network involved, per
// QS5.
function fakeDb(docs) {
  return {
    collection(name) {
      if (name !== 'products') throw new Error(`unexpected collection: ${name}`);
      return {
        where(field, op, value) {
          if (field !== 'isActive' || op !== '==' || value !== true) {
            throw new Error(`unexpected where clause: ${field} ${op} ${value}`);
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
}

function fakeDoc(id, data) {
  return { id, data: () => data };
}

describe('fetchLiveProducts', () => {
  it('maps active Firestore docs into products', async () => {
    const db = fakeDb([
      fakeDoc('abc', { title: 'Blue Branches', price: 70, isActive: true }),
    ]);

    const products = await fetchLiveProducts(db);

    expect(products).toEqual([
      expect.objectContaining({ id: 'abc', handle: 'blue-branches', price: 70 }),
    ]);
  });

  it('queries only isActive products, leaning on the where clause rather than filtering client-side', async () => {
    // fakeDb's where() itself asserts the query shape; a fetchLiveProducts
    // that queried differently (e.g. no filter, filtered client-side after
    // fetching everything) would throw here instead of returning cleanly.
    const db = fakeDb([fakeDoc('abc', { title: 'Active', price: 10, isActive: true })]);

    await expect(fetchLiveProducts(db)).resolves.not.toThrow();
  });

  it('dedupes handle collisions the same way the build-time snapshot does', async () => {
    const db = fakeDb([
      fakeDoc('1111aaaa', { title: 'Planter', price: 10, isActive: true }),
      fakeDoc('2222bbbb', { title: 'Planter', price: 20, isActive: true }),
    ]);

    const products = await fetchLiveProducts(db);

    expect(products.map((p) => p.handle)).toEqual(['planter', 'planter-bbbb']);
  });
});

describe('fetchLiveProductByHandle', () => {
  it('returns the product matching the given handle', async () => {
    const db = fakeDb([
      fakeDoc('abc', { title: 'Blue Branches', price: 70, isActive: true }),
      fakeDoc('def', { title: 'Yellow Planter', price: 40, isActive: true }),
    ]);

    const product = await fetchLiveProductByHandle(db, 'yellow-planter');

    expect(product).toEqual(expect.objectContaining({ id: 'def', price: 40 }));
  });

  it('returns null when no active product matches the handle', async () => {
    const db = fakeDb([
      fakeDoc('abc', { title: 'Blue Branches', price: 70, isActive: true }),
    ]);

    const product = await fetchLiveProductByHandle(db, 'does-not-exist');

    expect(product).toBeNull();
  });

  it('does not return a deactivated product even by its old handle', async () => {
    const db = fakeDb([
      fakeDoc('abc', { title: 'Druzy Pot', price: 1000, isActive: false }),
    ]);

    const product = await fetchLiveProductByHandle(db, 'druzy-pot');

    expect(product).toBeNull();
  });
});
