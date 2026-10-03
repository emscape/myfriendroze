// Pure logic behind the /cart page: joins the browser-stored cart with the
// live product catalog the page is rendered with. Prices, titles, stock and
// quantity limits always come from the live catalog, never from what was
// stored when a piece was added. Money is handled in cents to avoid
// floating-point drift in totals.

import { maxQtyForProduct } from './cart.js';
import { normalizeCategory } from './shop-categories.js';

/**
 * @typedef {{ id: string, handle: string, title: string, price: number,
 *   image: string, inStock: boolean, category: string,
 *   stockQuantity: number | null }} CartCatalogEntry
 * @typedef {{ sku: string, title: string, href: string | null, image: string,
 *   qty: number, maxQty: number, priceCents: number, lineTotalCents: number,
 *   status: 'ok' | 'sold-out' | 'unavailable' }} CartLine
 */

/**
 * The slice of each live product the cart page needs, small enough to embed
 * in the page.
 * @param {Array<{ id: string, handle: string, title: string, price: number,
 *   images: string[], inStock: boolean, category: string,
 *   stockQuantity?: number | null }>} products
 * @returns {CartCatalogEntry[]}
 */
export function catalogForCart(products) {
  return products.map(({ id, handle, title, price, images, inStock, category, stockQuantity }) => ({
    id,
    handle,
    title,
    price,
    image: images[0] ?? '',
    inStock,
    category,
    stockQuantity: stockQuantity ?? null,
  }));
}

function toCents(dollars) {
  return Math.round(dollars * 100);
}

/**
 * @param {import('./cart.js').Cart} cart
 * @param {CartCatalogEntry[]} catalog
 * @returns {{ lines: CartLine[], subtotalCents: number,
 *   checkoutItems: { sku: string, qty: number }[], hasProblems: boolean }}
 */
export function buildCartView(cart, catalog) {
  const bySku = new Map(catalog.map((entry) => [entry.id, entry]));

  const lines = cart.items.map((item) => {
    const product = bySku.get(item.sku);
    // Inactive, deleted and not-yet-published products aren't in the live
    // catalog at all.
    if (!product) {
      return {
        sku: item.sku,
        title: 'A piece that is no longer available',
        href: null,
        image: '',
        qty: item.qty,
        maxQty: item.qty,
        priceCents: 0,
        lineTotalCents: 0,
        status: 'unavailable',
      };
    }
    const maxQty = maxQtyForProduct(product.category, product.stockQuantity);
    const qty = Math.min(item.qty, maxQty);
    const priceCents = toCents(product.price);
    const status = product.inStock ? 'ok' : 'sold-out';
    return {
      sku: item.sku,
      title: product.title,
      href: `/products/${product.handle}`,
      image: product.image,
      qty,
      maxQty,
      priceCents,
      lineTotalCents: status === 'ok' ? priceCents * qty : 0,
      status,
    };
  });

  const okLines = lines.filter((line) => line.status === 'ok');
  return {
    lines,
    subtotalCents: okLines.reduce((sum, line) => sum + line.lineTotalCents, 0),
    checkoutItems: okLines.map(({ sku, qty }) => ({ sku, qty })),
    hasProblems: okLines.length !== lines.length,
  };
}

/**
 * Brings stored lines in line with the live catalog: each product's current
 * category, and its quantity capped at that category's limit and its stock. The cart
 * page's controls and the post-payment cleanup read the stored cart, so it
 * must agree with what the page shows and checks out. Pieces missing from
 * the catalog are left as they are (the page flags them). Returns the same
 * cart object when nothing changed.
 * @param {import('./cart.js').Cart} cart
 * @param {CartCatalogEntry[]} catalog
 * @returns {{ cart: import('./cart.js').Cart, changed: boolean }}
 */
export function reconcileCart(cart, catalog) {
  const bySku = new Map(catalog.map((entry) => [entry.id, entry]));
  let changed = false;
  const items = cart.items.map((item) => {
    const product = bySku.get(item.sku);
    if (!product) return item;
    const category = normalizeCategory(product.category);
    const qty = Math.min(item.qty, maxQtyForProduct(category, product.stockQuantity));
    if (category === item.category && qty === item.qty) return item;
    changed = true;
    return { ...item, category, qty };
  });
  return changed ? { cart: { items }, changed } : { cart, changed };
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * @param {number} cents
 * @returns {string}
 */
export function formatPrice(cents) {
  return USD.format(cents / 100);
}
