// Counts down a product's stock when a checkout is paid. Plants come in
// multiples, so Roze can give a product a stockQuantity in the admin app;
// checkout refuses more than that (lib/pricing.js), and stripeWebhook.js
// calls this in the transaction that writes the order, so stock goes down
// exactly once per paid order. Products without a stockQuantity are left
// alone. One-of-a-kind pieces are handled by lib/checkoutHolds.js instead.
//
// Nothing holds stock while a checkout is open, so two shoppers can pay
// for the last few at once; the count stops at 0 rather than going
// negative, and Roze sorts out the extra order by email.

/**
 * @param {Array<{quantity: number, price?: {product?: {metadata?: {sku?: string}}}}>} lineItems
 *   Stripe line items listed with data.price.product expanded
 * @returns {Map<string, number>} quantity bought, by sku
 */
function purchasedQuantities(lineItems) {
  const purchased = new Map();
  for (const li of lineItems) {
    const sku = li.price?.product?.metadata?.sku;
    if (sku) purchased.set(sku, (purchased.get(sku) ?? 0) + li.quantity);
  }
  return purchased;
}

/**
 * The read half, for use inside the caller's transaction before any of
 * its writes.
 *
 * @param {FirebaseFirestore.Transaction} tx
 * @param {FirebaseFirestore.Firestore} db
 * @param {Map<string, number>} purchased
 */
async function readStock(tx, db, purchased) {
  const skus = [...purchased.keys()];
  const products = await Promise.all(skus.map((sku) => tx.get(db.collection('products').doc(sku))));
  return products.map((product, i) => ({ product, quantity: purchased.get(skus[i]) }));
}

/**
 * The write half: counts each tracked product down, marking it sold out
 * at 0. A product deleted in the meantime is skipped rather than recreated.
 *
 * @param {FirebaseFirestore.Transaction} tx
 * @param {Awaited<ReturnType<typeof readStock>>} read
 */
function writeStockSold(tx, read) {
  for (const { product, quantity } of read) {
    if (!product.exists) continue;
    const { stockQuantity } = product.data();
    if (!Number.isInteger(stockQuantity)) continue;
    const remaining = Math.max(0, stockQuantity - quantity);
    tx.update(product.ref, remaining === 0 ? { stockQuantity: 0, inStock: false } : { stockQuantity: remaining });
  }
}

module.exports = { purchasedQuantities, readStock, writeStockSold };
