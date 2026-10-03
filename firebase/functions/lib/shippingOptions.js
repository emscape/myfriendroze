// Fixed shipping options for Stripe Checkout. Shipping is not quoted per
// order: orders of $50 or more ship free by ground; smaller orders pay a base fee
// that covers one item, plus a bundle surcharge for each item after it.
// Shoppers who give a Los Angeles ZIP can choose free local pickup instead. Local delivery is
// arranged by email, not sold here. Roze buys the actual postage separately
// (Pirate Ship), so these amounts are what the shopper pays, not a carrier
// rate.
//
// Pure, like lib/pricing.js: the caller passes in a subtotal and item
// categories it read from Firestore, never ones sent by the browser.

const { SHIPPING_TAX_CODE, TAX_BEHAVIOR } = require('./taxCodes');

const FREE_SHIPPING_THRESHOLD_CENTS = 5000;
const FLAT_SHIPPING_CENTS = 1000;
// Added for each item after the first, by product category. Anything that
// isn't a plant pays the pottery rate, the same default pricing.js uses.
const BUNDLE_SURCHARGE_CENTS = { plant: 200, pottery: 500 };

function surchargeFor(category) {
  return category === 'plant' ? BUNDLE_SURCHARGE_CENTS.plant : BUNDLE_SURCHARGE_CENTS.pottery;
}

/**
 * @param {Array<{category?: string, quantity: number}>} units
 * @returns {number} cents: the base fee, plus the surcharge for every unit
 *   except the one with the highest surcharge, which the base covers (so
 *   the listing order of a mixed cart doesn't change the price)
 */
function mailShippingCents(units) {
  const surcharges = units.flatMap(({ category, quantity }) => Array(quantity).fill(surchargeFor(category)));
  const total = surcharges.reduce((sum, cents) => sum + cents, 0);
  return FLAT_SHIPPING_CENTS + total - Math.max(...surcharges);
}

// method is stored in each rate's metadata so the webhook can tell which
// option was chosen: free shipping and local pickup both cost $0.
function option(method, displayName, amount) {
  return {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount, currency: 'usd' },
      display_name: displayName,
      tax_behavior: TAX_BEHAVIOR,
      tax_code: SHIPPING_TAX_CODE,
      metadata: { method },
    },
  };
}

/**
 * @param {Array<{price_data: {unit_amount: number}, quantity: number}>} lineItems
 *   as returned by pricing.js's buildLineItemsFromCatalog
 * @returns {number} subtotal in cents, before shipping
 */
function subtotalCents(lineItems) {
  return lineItems.reduce((sum, li) => sum + li.price_data.unit_amount * li.quantity, 0);
}

/**
 * @param {number} itemSubtotalCents - items only, before shipping
 * @param {Array<{category?: string, quantity: number}>} units - one entry
 *   per product in the order, with its Firestore category
 * @param {{local?: boolean}} [options] - local: the shopper gave a Los
 *   Angeles ZIP (lib/localArea.js), so local pickup is offered
 * @returns {Array<object>} Stripe Checkout shipping_options. Stripe
 *   preselects the first, so the mail option leads.
 */
function buildShippingOptions(itemSubtotalCents, units, { local = false } = {}) {
  if (!Number.isInteger(itemSubtotalCents) || itemSubtotalCents < 0) {
    throw new TypeError('itemSubtotalCents must be a non-negative integer');
  }
  if (
    !Array.isArray(units) ||
    units.length === 0 ||
    !units.every((u) => Number.isInteger(u?.quantity) && u.quantity > 0)
  ) {
    throw new TypeError('units must be a non-empty array of positive integer quantities');
  }
  const mail =
    itemSubtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
      ? option('free_shipping', 'Free ground shipping', 0)
      : option('shipping', 'Ground shipping', mailShippingCents(units));
  return local ? [mail, option('local_pickup', 'Local pickup — Los Angeles', 0)] : [mail];
}

module.exports = {
  subtotalCents,
  buildShippingOptions,
  FREE_SHIPPING_THRESHOLD_CENTS,
  FLAT_SHIPPING_CENTS,
  BUNDLE_SURCHARGE_CENTS,
};
