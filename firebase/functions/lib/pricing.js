// Pure pricing logic for Stripe Checkout — no Firestore/Stripe calls here,
// which is what makes it unit-testable without live infrastructure (same
// pattern as astro/scripts/fetch-gallery.mjs's docToGalleryPhoto).
//
// The single reason this module exists: the previous (undeployed, now
// deleted) createOrder function trusted client-supplied prices completely,
// which would let anyone tamper with a checkout request to pay whatever
// they wanted. buildLineItemsFromCatalog only ever prices from the
// Firestore-sourced catalog passed in by the caller — a client-supplied
// price field, if present at all, is never read.

const { PRODUCT_TAX_CODE, TAX_BEHAVIOR } = require('./taxCodes');

const MIN_QTY = 1;
// Most of any one product a single order can buy, by product category.
// Pottery and "other" pieces are one of a kind; plants come in multiples.
// A missing or unrecognised category counts as pottery, matching the
// site's shop pages (astro/src/lib/shop-categories.js). Keep in step with
// the cart's copy of these limits on the site.
const MAX_QTY_BY_CATEGORY = { pottery: 1, plant: 20, other: 1 };
const DEFAULT_CATEGORY = 'pottery';
// Distinct products per order — an abuse bound for direct API POSTs (each
// one costs a Firestore read), well under Stripe Checkout's own 100
// line-item limit.
const MAX_ITEMS = 50;

class CatalogValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CatalogValidationError';
    this.code = code;
  }
}

function dollarsToCents(amount) {
  return Math.round(amount * 100);
}

function maxQtyFor(product) {
  // typeof first: Object.hasOwn coerces its key, so ['plant'] would
  // otherwise match "plant" (the site's normalizeCategory compares strictly).
  return typeof product.category === 'string' && Object.hasOwn(MAX_QTY_BY_CATEGORY, product.category)
    ? MAX_QTY_BY_CATEGORY[product.category]
    : MAX_QTY_BY_CATEGORY[DEFAULT_CATEGORY];
}

/**
 * Shape checks on the item list that need no catalog, so the caller can
 * run them before reading any product from Firestore.
 *
 * @param {{sku: string, qty: number}[]} items
 * @throws {CatalogValidationError}
 */
function validateItemList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CatalogValidationError('EMPTY_ITEMS', 'At least one item is required');
  }
  if (items.length > MAX_ITEMS) {
    throw new CatalogValidationError('TOO_MANY_ITEMS', `An order can include at most ${MAX_ITEMS} products`);
  }
  // A sku listed twice would let each copy pass the per-product quantity
  // limit on its own; the cart always sends one entry per product.
  const seen = new Set();
  for (const item of items) {
    // Client JSON: a null, primitive or sku-less entry must be a 400 here,
    // not a TypeError further on that surfaces as a 500.
    if (!item || typeof item !== 'object' || typeof item.sku !== 'string' || item.sku === '') {
      throw new CatalogValidationError('INVALID_ITEM', 'Each item must be an object with a sku');
    }
    const { sku } = item;
    if (seen.has(sku)) {
      throw new CatalogValidationError('DUPLICATE_SKU', `Product listed more than once: ${sku}`);
    }
    seen.add(sku);
  }
}

/**
 * Builds Stripe Checkout line items from client-supplied {sku, qty} pairs,
 * pricing every item exclusively from the given catalog (a Map<sku,
 * productDoc> sourced from Firestore by the caller). Any other
 * client-supplied fields on an item (price, name, description, ...) are
 * ignored entirely — they are never read, let alone trusted.
 *
 * @param {{sku: string, qty: number}[]} items
 * @param {Map<string, {title: string, price: number, isActive: boolean, inStock?: boolean}>} catalog
 * @returns {Array<{price_data: {currency: string, product_data: {name: string, tax_code: string}, unit_amount: number, tax_behavior: string}, quantity: number}>}
 * @throws {CatalogValidationError}
 */
function buildLineItemsFromCatalog(items, catalog) {
  validateItemList(items);

  return items.map(({ sku, qty }) => {
    const product = catalog.get(sku);
    if (!product) {
      throw new CatalogValidationError('UNKNOWN_SKU', `No product found for sku: ${sku}`);
    }
    // Fail closed: this is a checkout security boundary (the caller fetches
    // a product doc directly by sku, with no isActive==true query filter of
    // its own — this check is the only thing standing between a request
    // and buying an inactive product), so isActive must be the literal
    // boolean true. A missing field, a truthy-but-wrong value, or anything
    // else that merely isn't `=== false` must not be treated as active.
    if (product.isActive !== true) {
      throw new CatalogValidationError('INACTIVE_PRODUCT', `Product is not active: ${sku}`);
    }
    // A sold-out product can still be isActive (shown on the site with a
    // disabled "Sold Out" button) — that UI state is a courtesy, not a
    // security boundary, so it's enforced here too. Unlike isActive above,
    // a *missing* inStock field deliberately still defaults to purchasable
    // (matches product-mapping.js's docToProduct — no admin-app migration
    // needed for existing products) — but a *present* value that isn't a
    // real boolean is malformed data, not "no opinion", and must not
    // silently fall through to purchasable either.
    if (product.inStock === false || (product.inStock !== undefined && typeof product.inStock !== 'boolean')) {
      throw new CatalogValidationError('OUT_OF_STOCK', `Product is out of stock: ${sku}`);
    }
    // Delayed/scheduled publish (see astro/src/lib/products-live.js and
    // firestore.rules) hides a product from the shop and blocks direct
    // Firestore reads before its reveal time, but this function fetches
    // the doc straight by sku with no query filter of its own — a caller
    // who already knows/guesses a scheduled sku could otherwise still
    // check out with it while isActive: true. Same fail-closed reasoning
    // as isActive/inStock above.
    if (product.publishAt && product.publishAt.toMillis() > Date.now()) {
      throw new CatalogValidationError('NOT_YET_PUBLISHED', `Product is not yet published: ${sku}`);
    }
    // Optional stock count (plants; set in the admin app). Absent or null
    // means untracked. A present value that isn't a whole number of 0 or
    // more is malformed data and fails closed, like inStock above.
    const { stockQuantity } = product;
    const tracksStock = stockQuantity !== undefined && stockQuantity !== null;
    if (tracksStock && !(Number.isInteger(stockQuantity) && stockQuantity > 0)) {
      throw new CatalogValidationError('OUT_OF_STOCK', `Product is out of stock: ${sku}`);
    }
    const maxQty = tracksStock ? Math.min(maxQtyFor(product), stockQuantity) : maxQtyFor(product);
    if (!Number.isInteger(qty) || qty < MIN_QTY || qty > maxQty) {
      throw new CatalogValidationError(
        'INVALID_QTY',
        `Quantity must be an integer between ${MIN_QTY} and ${maxQty} for sku: ${sku}`
      );
    }

    return {
      price_data: {
        currency: 'usd',
        // The sku comes back on the paid session's line items, so the
        // webhook can count stock down (lib/stockCounts.js).
        product_data: { name: product.title, tax_code: PRODUCT_TAX_CODE, metadata: { sku } },
        unit_amount: dollarsToCents(product.price),
        tax_behavior: TAX_BEHAVIOR,
      },
      quantity: qty,
    };
  });
}

module.exports = {
  buildLineItemsFromCatalog,
  validateItemList,
  CatalogValidationError,
  dollarsToCents,
  maxQtyFor,
  MAX_ITEMS,
  MAX_QTY_BY_CATEGORY,
};
