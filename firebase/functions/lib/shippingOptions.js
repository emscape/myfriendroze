// Fixed shipping options for Stripe Checkout. Shipping is not quoted per
// order: pottery prices already include shipping, orders of $50 or more
// ship free, smaller orders pay a flat fee, and shoppers who give a Los
// Angeles ZIP can choose free local pickup instead. Local delivery is
// arranged by email, not sold here. Roze buys the actual postage separately
// (Pirate Ship), so these amounts are what the shopper pays, not a carrier
// rate.
//
// Pure, like lib/pricing.js: the caller passes in a subtotal it computed
// from Firestore prices, never one sent by the browser.

const FREE_SHIPPING_THRESHOLD_CENTS = 5000;
const FLAT_SHIPPING_CENTS = 1000;

// method is stored in each rate's metadata so the webhook can tell which
// option was chosen: free shipping and local pickup both cost $0.
function option(method, displayName, amount) {
  return {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount, currency: 'usd' },
      display_name: displayName,
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
 * @param {{local?: boolean}} [options] - local: the shopper gave a Los
 *   Angeles ZIP (lib/localArea.js), so local pickup is offered
 * @returns {Array<object>} Stripe Checkout shipping_options. Stripe
 *   preselects the first, so the mail option leads.
 */
function buildShippingOptions(itemSubtotalCents, { local = false } = {}) {
  if (!Number.isInteger(itemSubtotalCents) || itemSubtotalCents < 0) {
    throw new TypeError('itemSubtotalCents must be a non-negative integer');
  }
  const mail =
    itemSubtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
      ? option('free_shipping', 'Free shipping', 0)
      : option('shipping', 'Shipping', FLAT_SHIPPING_CENTS);
  return local ? [mail, option('local_pickup', 'Local pickup — Los Angeles', 0)] : [mail];
}

module.exports = {
  subtotalCents,
  buildShippingOptions,
  FREE_SHIPPING_THRESHOLD_CENTS,
  FLAT_SHIPPING_CENTS,
};
