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

const MIN_QTY = 1;
const MAX_QTY = 20; // abuse-protection bound for direct API POSTs, not a
// business requirement — this site's checkout has only ever sent a
// single-item cart with qty 1 in practice.

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

/**
 * Builds Stripe Checkout line items from client-supplied {sku, qty} pairs,
 * pricing every item exclusively from the given catalog (a Map<sku,
 * productDoc> sourced from Firestore by the caller). Any other
 * client-supplied fields on an item (price, name, description, ...) are
 * ignored entirely — they are never read, let alone trusted.
 *
 * @param {{sku: string, qty: number}[]} items
 * @param {Map<string, {title: string, price: number, isActive: boolean}>} catalog
 * @returns {Array<{price_data: {currency: string, product_data: {name: string}, unit_amount: number}, quantity: number}>}
 * @throws {CatalogValidationError}
 */
function buildLineItemsFromCatalog(items, catalog) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CatalogValidationError('EMPTY_ITEMS', 'At least one item is required');
  }

  return items.map(({ sku, qty }) => {
    const product = catalog.get(sku);
    if (!product) {
      throw new CatalogValidationError('UNKNOWN_SKU', `No product found for sku: ${sku}`);
    }
    if (product.isActive === false) {
      throw new CatalogValidationError('INACTIVE_PRODUCT', `Product is not active: ${sku}`);
    }
    // A sold-out product can still be isActive (shown on the site with a
    // disabled "Sold Out" button) — that UI state is a courtesy, not a
    // security boundary, so it's enforced here too.
    if (product.inStock === false) {
      throw new CatalogValidationError('OUT_OF_STOCK', `Product is out of stock: ${sku}`);
    }
    if (!Number.isInteger(qty) || qty < MIN_QTY || qty > MAX_QTY) {
      throw new CatalogValidationError(
        'INVALID_QTY',
        `Quantity must be an integer between ${MIN_QTY} and ${MAX_QTY} for sku: ${sku}`
      );
    }

    return {
      price_data: {
        currency: 'usd',
        product_data: { name: product.title },
        unit_amount: dollarsToCents(product.price),
      },
      quantity: qty,
    };
  });
}

module.exports = { buildLineItemsFromCatalog, CatalogValidationError, dollarsToCents };
