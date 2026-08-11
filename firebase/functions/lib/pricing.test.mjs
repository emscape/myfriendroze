import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import — see orderFromSession.test.mjs for
// why: pricing.js is also require()'d by createCheckoutSession.js, and
// loading it a second way here caused v8's coverage merging to
// under-report real coverage for this file.
const require = createRequire(import.meta.url);
const { buildLineItemsFromCatalog, CatalogValidationError } = require('./pricing.js');

function catalogWith(entries) {
  return new Map(Object.entries(entries));
}

describe('buildLineItemsFromCatalog', () => {
  it('builds a Stripe line item from the catalog-sourced price, in cents', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true },
    });

    const lineItems = buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog);

    expect(lineItems).toEqual([
      {
        price_data: {
          currency: 'usd',
          product_data: { name: 'Blue Branches' },
          unit_amount: 7000,
        },
        quantity: 1,
      },
    ]);
  });

  // This is the actual security guarantee this module exists to provide —
  // a client tampering with the request body must not be able to change
  // what gets charged. Only the server-side Firestore catalog price wins.
  it('ignores a client-supplied price entirely, even when tampered', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true },
    });

    const poisonedItem = { sku: 'sku-1', qty: 1, price: 0.01 };

    const lineItems = buildLineItemsFromCatalog([poisonedItem], catalog);

    expect(lineItems[0].price_data.unit_amount).toBe(7000);
  });

  it('builds multiple line items in the order given, each priced independently', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true },
      'sku-2': { title: 'Pineapple Planter', price: 45.5, isActive: true },
    });

    const lineItems = buildLineItemsFromCatalog(
      [
        { sku: 'sku-1', qty: 2 },
        { sku: 'sku-2', qty: 1 },
      ],
      catalog
    );

    expect(lineItems).toHaveLength(2);
    expect(lineItems[0].quantity).toBe(2);
    expect(lineItems[0].price_data.unit_amount).toBe(7000);
    expect(lineItems[1].quantity).toBe(1);
    expect(lineItems[1].price_data.unit_amount).toBe(4550);
  });

  it('rounds fractional cents correctly rather than truncating', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Odd Price Item', price: 19.999, isActive: true },
    });

    const lineItems = buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog);

    expect(lineItems[0].price_data.unit_amount).toBe(2000);
  });

  it('throws CatalogValidationError for a sku not in the catalog', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true },
    });

    expect(() =>
      buildLineItemsFromCatalog([{ sku: 'does-not-exist', qty: 1 }], catalog)
    ).toThrow(CatalogValidationError);
  });

  it('throws for a product marked inactive', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Discontinued Planter', price: 70, isActive: false },
    });

    expect(() => buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog)).toThrow(
      CatalogValidationError
    );
  });

  it.each([0, -1, 21, 999])('throws for an out-of-bounds quantity of %i', (qty) => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true },
    });

    expect(() => buildLineItemsFromCatalog([{ sku: 'sku-1', qty }], catalog)).toThrow(
      CatalogValidationError
    );
  });

  it.each([1, 20])('allows the boundary quantities %i', (qty) => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true },
    });

    expect(() =>
      buildLineItemsFromCatalog([{ sku: 'sku-1', qty }], catalog)
    ).not.toThrow();
  });

  it('throws for an empty items array', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true },
    });

    expect(() => buildLineItemsFromCatalog([], catalog)).toThrow(CatalogValidationError);
  });

  it('throws when items is not an array at all', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true },
    });

    expect(() => buildLineItemsFromCatalog(undefined, catalog)).toThrow(
      CatalogValidationError
    );
  });
});
