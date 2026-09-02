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

  // This is a checkout security boundary, not just a UI filter — the
  // caller (createCheckoutSession.js) fetches a product doc directly by
  // sku, with no isActive==true query filter of its own, so this check is
  // the *only* thing standing between a request and buying an inactive
  // product. It must fail closed: require isActive === true explicitly,
  // rather than only rejecting an explicit false. A doc with the field
  // missing, misspelled, or holding a truthy-but-wrong value (a stray "1"
  // string, say) must not be purchasable just because it isn't literally
  // `false`.
  it.each([undefined, 'true', 1, null, {}])(
    'throws for a product whose isActive is not the literal boolean true (%j)',
    (badIsActive) => {
      const catalog = catalogWith({
        'sku-1': { title: 'Ambiguous Product', price: 70, isActive: badIsActive },
      });

      expect(() => buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog)).toThrow(
        CatalogValidationError
      );
    }
  );

  // A sold-out product is still shown on the site (isActive: true) with a
  // disabled "Sold Out" button — that's a UI courtesy, not a security
  // boundary. A tampered/direct API request must be rejected here too,
  // the same as an inactive product, so someone can't buy an out-of-stock
  // item just by hitting the endpoint directly.
  it('throws for a product marked out of stock, even though it is active', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Sold Out Planter', price: 70, isActive: true, inStock: false },
    });

    expect(() => buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog)).toThrow(
      CatalogValidationError
    );
  });

  it('allows a product with no inStock field at all (defaults to purchasable)', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true },
    });

    expect(() =>
      buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog)
    ).not.toThrow();
  });

  // Distinct from the "field absent" case above, which deliberately still
  // defaults to purchasable (no admin-app migration needed) — a *present*
  // inStock value that isn't a real boolean is malformed data, not "no
  // opinion", and must not silently fall through to purchasable.
  it.each(['false', 0, 'true', {}, []])(
    'throws for a product whose inStock is present but not a real boolean (%j)',
    (badInStock) => {
      const catalog = catalogWith({
        'sku-1': { title: 'Malformed Stock Field', price: 70, isActive: true, inStock: badInStock },
      });

      expect(() => buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog)).toThrow(
        CatalogValidationError
      );
    }
  );

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
