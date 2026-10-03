import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { memoryFirestore } from '../test-support/memoryFirestore.mjs';

// createRequire, not a static import — see vitest.config.js.
const require = createRequire(import.meta.url);
const { purchasedQuantities, readStock, writeStockSold } = require('./stockCounts.js');

// A Stripe line item as listLineItems returns it with data.price.product
// expanded.
function lineItem(sku, quantity) {
  return { description: sku, quantity, price: { product: { metadata: sku ? { sku } : {} } } };
}

const FERN = { title: 'Fern', price: 12, isActive: true, inStock: true, category: 'plant' };

async function sell(docs, lineItems) {
  const db = memoryFirestore(docs);
  const purchased = purchasedQuantities(lineItems);
  await db.runTransaction(async (tx) => {
    const read = await readStock(tx, db, purchased);
    writeStockSold(tx, read);
  });
  return db;
}

describe('purchasedQuantities', () => {
  it('maps each sku to the quantity bought', () => {
    expect(purchasedQuantities([lineItem('fern', 3), lineItem('bowl', 1)])).toEqual(
      new Map([
        ['fern', 3],
        ['bowl', 1],
      ])
    );
  });

  it('skips line items with no sku, such as checkouts started before skus were sent', () => {
    expect(purchasedQuantities([lineItem(undefined, 2), { description: 'x', quantity: 1 }])).toEqual(new Map());
  });
});

describe('selling stock', () => {
  it('counts the stock down by the quantity bought', async () => {
    const db = await sell({ 'products/fern': { ...FERN, stockQuantity: 5 } }, [lineItem('fern', 2)]);

    expect(db.dump('products/fern')).toEqual({ ...FERN, stockQuantity: 3 });
  });

  it('marks the product sold out when the last one sells', async () => {
    const db = await sell({ 'products/fern': { ...FERN, stockQuantity: 2 } }, [lineItem('fern', 2)]);

    expect(db.dump('products/fern')).toEqual({ ...FERN, stockQuantity: 0, inStock: false });
  });

  it('stops at 0 rather than going negative when two checkouts bought the last ones', async () => {
    const db = await sell({ 'products/fern': { ...FERN, stockQuantity: 1 } }, [lineItem('fern', 3)]);

    expect(db.dump('products/fern')).toEqual({ ...FERN, stockQuantity: 0, inStock: false });
  });

  it('leaves products without a stock count alone', async () => {
    const db = await sell({ 'products/fern': FERN }, [lineItem('fern', 2)]);

    expect(db.dump('products/fern')).toEqual(FERN);
  });

  it('skips a product deleted since checkout rather than recreating it', async () => {
    const db = await sell({}, [lineItem('fern', 1)]);

    expect(db.has('products/fern')).toBe(false);
  });
});
