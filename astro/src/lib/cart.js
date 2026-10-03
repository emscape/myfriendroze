// Pure shopping-cart logic: no storage or DOM access, so it's unit-testable
// directly (cart-store.js handles persistence). A cart only holds sku,
// category and quantity; prices, titles and stock are always read live, and
// the server prices every checkout from Firestore regardless of what the
// browser sends (firebase/functions/lib/pricing.js).

import { normalizeCategory } from './shop-categories.js';

/**
 * @typedef {{ sku: string, category: string, qty: number }} CartItem
 * @typedef {{ items: CartItem[] }} Cart
 */

/** @type {Cart} */
export const EMPTY_CART = Object.freeze({ items: Object.freeze([]) });

// Mirrors MAX_QTY_BY_CATEGORY and MAX_ITEMS in
// firebase/functions/lib/pricing.js, which enforces them at checkout; keep
// the two in step. Pottery and "other" pieces are one of a kind.
const MAX_QTY_BY_CATEGORY = { pottery: 1, plant: 20, other: 1 };
export const MAX_CART_ITEMS = 50;

/**
 * Most of one product a cart can hold. A missing or unknown category counts
 * as pottery, as it does on the shop pages.
 * @param {unknown} category
 * @returns {number}
 */
export function maxQtyForCategory(category) {
  return MAX_QTY_BY_CATEGORY[normalizeCategory(category)];
}

/**
 * Most of one product a cart can hold, given its live stock count (plants
 * may have one; null means untracked). Never below 1: a product with none
 * left is shown as sold out, and its stored quantity is left as it is.
 * firebase/functions/lib/pricing.js enforces the same cap at checkout.
 * @param {unknown} category
 * @param {number | null | undefined} stockQuantity
 * @returns {number}
 */
export function maxQtyForProduct(category, stockQuantity) {
  const categoryMax = maxQtyForCategory(category);
  if (stockQuantity === null || stockQuantity === undefined) return categoryMax;
  return Math.max(1, Math.min(categoryMax, stockQuantity));
}

function clampQty(qty, category) {
  return Math.min(qty, maxQtyForCategory(category));
}

/**
 * Adds a product, merging with any existing entry for the same sku.
 * Status is 'added', 'limited' (the quantity hit the category limit, which
 * includes a one-of-a-kind piece already in the cart), or 'full' (the cart
 * already holds MAX_CART_ITEMS other products; nothing changed).
 * @param {Cart} cart
 * @param {{ sku: string, category: unknown, qty?: number }} product
 * @returns {{ cart: Cart, status: 'added' | 'limited' | 'full' }}
 */
export function addToCart(cart, { sku, category, qty = 1 }) {
  const existing = cart.items.find((item) => item.sku === sku);
  if (!existing && cart.items.length >= MAX_CART_ITEMS) {
    return { cart, status: 'full' };
  }

  const wanted = (existing ? existing.qty : 0) + qty;
  // The caller's category is the product's current one; the stored one is
  // only a fallback, since the product may have been recategorised.
  const itemCategory = normalizeCategory(category ?? existing?.category);
  const newQty = clampQty(wanted, itemCategory);
  const status = newQty < wanted ? 'limited' : 'added';

  const items = existing
    ? cart.items.map((item) => (item.sku === sku ? { ...item, category: itemCategory, qty: newQty } : item))
    : [...cart.items, { sku, category: itemCategory, qty: newQty }];
  return { cart: { items }, status };
}

/**
 * Sets a product's quantity, capped at its category limit; below 1 removes
 * it. An unknown sku leaves the cart unchanged.
 * @param {Cart} cart
 * @param {string} sku
 * @param {number} qty
 * @returns {Cart}
 */
export function setQuantity(cart, sku, qty) {
  if (!cart.items.some((item) => item.sku === sku)) return cart;
  if (!(qty >= 1)) return removeFromCart(cart, sku);
  return {
    items: cart.items.map((item) =>
      item.sku === sku ? { ...item, qty: clampQty(Math.floor(qty), item.category) } : item
    ),
  };
}

/**
 * @param {Cart} cart
 * @param {string} sku
 * @returns {Cart}
 */
export function removeFromCart(cart, sku) {
  return { items: cart.items.filter((item) => item.sku !== sku) };
}

/**
 * Total units in the cart, for the header count.
 * @param {Cart} cart
 * @returns {number}
 */
export function cartItemCount(cart) {
  return cart.items.reduce((sum, item) => sum + item.qty, 0);
}

/**
 * The {sku, qty} list /api/checkout accepts.
 * @param {Cart} cart
 * @returns {{ sku: string, qty: number }[]}
 */
export function checkoutItems(cart) {
  return cart.items.map(({ sku, qty }) => ({ sku, qty }));
}

/**
 * @param {Cart} cart
 * @returns {string}
 */
export function serializeCart(cart) {
  return JSON.stringify({ items: cart.items });
}

/**
 * Reads a stored cart. The data comes from the visitor's own browser, so
 * anything unreadable becomes an empty cart, malformed entries are dropped,
 * and quantities and product counts are re-capped rather than trusted.
 * @param {string | null} raw
 * @returns {Cart}
 */
export function parseCart(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw ?? '');
  } catch {
    return EMPTY_CART;
  }
  if (!parsed || !Array.isArray(parsed.items)) return EMPTY_CART;

  let cart = EMPTY_CART;
  for (const entry of parsed.items) {
    if (!entry || typeof entry.sku !== 'string' || entry.sku === '') continue;
    if (!Number.isInteger(entry.qty) || entry.qty < 1) continue;
    cart = addToCart(cart, { sku: entry.sku, category: entry.category, qty: entry.qty }).cart;
  }
  return cart;
}
