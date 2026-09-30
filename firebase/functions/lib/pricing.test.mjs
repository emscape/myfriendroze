import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import — see orderFromSession.test.mjs for
// why: pricing.js is also require()'d by createCheckoutSession.js, and
// loading it a second way here caused v8's coverage merging to
// under-report real coverage for this file.
const require = createRequire(import.meta.url);
const {
  buildLineItemsFromCatalog,
  validateItemList,
  CatalogValidationError,
  MAX_ITEMS,
} = require('./pricing.js');

function catalogWith(entries) {
  return new Map(Object.entries(entries));
}

// The CatalogValidationError code a call throws, or null if it doesn't throw.
function errorCodeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error instanceof CatalogValidationError ? error.code : `unexpected: ${error}`;
  }
  return null;
}

function fakeTimestamp(dateString) {
  const date = new Date(dateString);
  return { toMillis: () => date.getTime() };
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
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true, category: 'plant' },
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
      'sku-1': { title: 'Echeveria', price: 12, isActive: true, category: 'plant' },
    });

    expect(() => buildLineItemsFromCatalog([{ sku: 'sku-1', qty }], catalog)).toThrow(
      CatalogValidationError
    );
  });

  it.each([1, 20])('allows the boundary quantities %i', (qty) => {
    const catalog = catalogWith({
      'sku-1': { title: 'Echeveria', price: 12, isActive: true, category: 'plant' },
    });

    expect(() =>
      buildLineItemsFromCatalog([{ sku: 'sku-1', qty }], catalog)
    ).not.toThrow();
  });

  // Checkout security boundary, same reasoning as the isActive/inStock
  // checks above: createCheckoutSession.js fetches a product doc directly
  // by sku (no isActive/publishAt query filter of its own), so this is the
  // only thing standing between a request and buying a scheduled product
  // before its public reveal — a client that already knows/guesses a
  // scheduled sku must not be able to check out with it just because the
  // product is isActive: true.
  it('throws for a product whose publishAt is still in the future', () => {
    const catalog = catalogWith({
      'sku-1': {
        title: 'Not Yet Revealed',
        price: 70,
        isActive: true,
        publishAt: fakeTimestamp('2999-01-01'),
      },
    });

    expect(() => buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog)).toThrow(
      CatalogValidationError
    );
  });

  it('allows a product whose publishAt has already passed', () => {
    const catalog = catalogWith({
      'sku-1': {
        title: 'Already Live',
        price: 70,
        isActive: true,
        publishAt: fakeTimestamp('2000-01-01'),
      },
    });

    expect(() =>
      buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog)
    ).not.toThrow();
  });

  it('allows a product with no publishAt field at all (pre-existing docs)', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Legacy Product', price: 70, isActive: true },
    });

    expect(() =>
      buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog)
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

  // Per-category quantity limits: pottery and "other" pieces are one of a
  // kind; plants can be bought in multiples.
  it('allows up to 20 of a plant', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Echeveria', price: 12, isActive: true, category: 'plant' },
    });

    const lineItems = buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 20 }], catalog);

    expect(lineItems[0].quantity).toBe(20);
  });

  it('rejects more than 20 of a plant', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Echeveria', price: 12, isActive: true, category: 'plant' },
    });

    expect(errorCodeOf(() => buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 21 }], catalog))).toBe(
      'INVALID_QTY'
    );
  });

  it.each(['pottery', 'other'])('rejects more than 1 of a one-of-a-kind %s product', (category) => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true, category },
    });

    expect(buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 1 }], catalog)[0].quantity).toBe(1);
    expect(errorCodeOf(() => buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 2 }], catalog))).toBe(
      'INVALID_QTY'
    );
  });

  // Matches the site, which lists a product with a missing or unknown
  // category on the pottery shop page.
  // Non-string values included: Object.hasOwn would coerce ['plant'] to
  // "plant" and grant the plant limit.
  it.each([undefined, 'mystery', ['plant'], { toString: () => 'plant' }, 7])('treats a product with category %j as pottery (limit 1)', (category) => {
    const catalog = catalogWith({
      'sku-1': { title: 'Uncategorised', price: 70, isActive: true, category },
    });

    expect(errorCodeOf(() => buildLineItemsFromCatalog([{ sku: 'sku-1', qty: 2 }], catalog))).toBe(
      'INVALID_QTY'
    );
  });

  // Listing a sku twice would otherwise let two separate line items each
  // pass the per-product quantity limit.
  it('rejects the same sku listed twice', () => {
    const catalog = catalogWith({
      'sku-1': { title: 'Blue Branches', price: 70, isActive: true },
    });

    expect(
      errorCodeOf(() =>
        buildLineItemsFromCatalog(
          [
            { sku: 'sku-1', qty: 1 },
            { sku: 'sku-1', qty: 1 },
          ],
          catalog
        )
      )
    ).toBe('DUPLICATE_SKU');
  });
});

describe('validateItemList', () => {
  function items(count) {
    return Array.from({ length: count }, (_, i) => ({ sku: `sku-${i}`, qty: 1 }));
  }

  it(`accepts up to ${MAX_ITEMS} distinct items`, () => {
    expect(errorCodeOf(() => validateItemList(items(MAX_ITEMS)))).toBeNull();
  });

  it(`rejects more than ${MAX_ITEMS} distinct items`, () => {
    expect(errorCodeOf(() => validateItemList(items(MAX_ITEMS + 1)))).toBe('TOO_MANY_ITEMS');
  });

  it('rejects the same sku listed twice', () => {
    expect(
      errorCodeOf(() =>
        validateItemList([
          { sku: 'sku-1', qty: 1 },
          { sku: 'sku-1', qty: 2 },
        ])
      )
    ).toBe('DUPLICATE_SKU');
  });

  it('rejects an empty or missing items list', () => {
    expect(errorCodeOf(() => validateItemList([]))).toBe('EMPTY_ITEMS');
    expect(errorCodeOf(() => validateItemList(undefined))).toBe('EMPTY_ITEMS');
  });
});
