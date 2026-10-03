// What the site tells shoppers about shipping, in dollars. Checkout charges
// from firebase/functions/lib/shippingOptions.js; keep these in step with it
// (shipping-policy.test.mjs checks they match).

export const FREE_SHIPPING_THRESHOLD = 50;
export const FLAT_SHIPPING = 10;
// Added for each item after the first, by category.
export const BUNDLE_SURCHARGE = { plant: 2, pottery: 5 };

export function shippingSummary() {
  return (
    `Free ground shipping when your items total $${FREE_SHIPPING_THRESHOLD} or more. ` +
    `Otherwise ground shipping is $${FLAT_SHIPPING} for the first item, plus $${BUNDLE_SURCHARGE.plant} for each additional plant ` +
    `and $${BUNDLE_SURCHARGE.pottery} for each additional ceramic piece. ` +
    'Free local pickup in Los Angeles; contact us for local delivery options.'
  );
}
