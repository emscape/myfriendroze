// What the site tells shoppers about shipping, in dollars. Checkout charges
// from firebase/functions/lib/shippingOptions.js; keep these in step with it
// (shipping-policy.test.mjs checks they match).

export const FREE_SHIPPING_THRESHOLD = 50;
export const FLAT_SHIPPING = 10;

export function shippingSummary() {
  return (
    `Free shipping when your items total $${FREE_SHIPPING_THRESHOLD} or more; $${FLAT_SHIPPING} shipping otherwise. ` +
    'Free local pickup in Los Angeles; contact us for local delivery options.'
  );
}
