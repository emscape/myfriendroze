// Stripe Tax settings shared by line items (lib/pricing.js) and shipping
// rates (lib/shippingOptions.js). Prices on the site are before tax, so
// both are tax-exclusive: Stripe Tax adds California sales tax on top at
// checkout, based on the shipping address, and decides whether shipping
// itself is taxable from its tax code.

// Stripe's "General - Tangible Goods" code.
const PRODUCT_TAX_CODE = 'txcd_99999999';
// Stripe's "Shipping" code.
const SHIPPING_TAX_CODE = 'txcd_92010001';
const TAX_BEHAVIOR = 'exclusive';

module.exports = { PRODUCT_TAX_CODE, SHIPPING_TAX_CODE, TAX_BEHAVIOR };
