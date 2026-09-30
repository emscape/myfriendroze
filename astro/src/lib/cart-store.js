// Persists the cart in the visitor's browser (localStorage) and tells the
// page when it changes. Storage and the event target are parameters so this
// is testable outside a browser; pages call these with the defaults.
//
// localStorage can throw (private browsing, blocked site data) or be
// missing entirely, so every access is guarded: the cart then behaves as
// empty and saves report failure instead of breaking the page.

import { EMPTY_CART, parseCart, serializeCart, cartItemCount, setQuantity } from './cart.js';

export const CART_STORAGE_KEY = 'myfriendroze-cart';
export const CART_CHANGED_EVENT = 'cart:changed';
// Per-tab (sessionStorage) note of the Stripe session a cart checkout started
// and the items it sent.
export const CART_CHECKOUT_KEY = 'myfriendroze-cart-checkout';

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function defaultSessionStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function defaultTarget() {
  return typeof window !== 'undefined' ? window : null;
}

/**
 * @param {Storage | null} [storage]
 * @returns {import('./cart.js').Cart}
 */
export function loadCart(storage = defaultStorage()) {
  try {
    return storage ? parseCart(storage.getItem(CART_STORAGE_KEY)) : EMPTY_CART;
  } catch {
    return EMPTY_CART;
  }
}

/**
 * Stores the cart and dispatches CART_CHANGED_EVENT with the new item count.
 * @param {import('./cart.js').Cart} cart
 * @param {Storage | null} [storage]
 * @param {EventTarget | null} [target]
 * @returns {boolean} whether the cart was saved
 */
export function saveCart(cart, storage = defaultStorage(), target = defaultTarget()) {
  try {
    if (!storage) return false;
    storage.setItem(CART_STORAGE_KEY, serializeCart(cart));
  } catch {
    return false;
  }
  target?.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: { count: cartItemCount(cart) } }));
  return true;
}

/**
 * Calls back with the current cart whenever it changes, on this page or in
 * another open tab. Returns a function that stops listening.
 * @param {(cart: import('./cart.js').Cart) => void} callback
 * @param {Storage | null} [storage]
 * @param {EventTarget | null} [target]
 * @returns {() => void}
 */
export function onCartChange(callback, storage = defaultStorage(), target = defaultTarget()) {
  if (!target) return () => {};
  const onLocalChange = () => callback(loadCart(storage));
  const onStorage = (event) => {
    if (event.key === CART_STORAGE_KEY) callback(loadCart(storage));
  };
  target.addEventListener(CART_CHANGED_EVENT, onLocalChange);
  target.addEventListener('storage', onStorage);
  return () => {
    target.removeEventListener(CART_CHANGED_EVENT, onLocalChange);
    target.removeEventListener('storage', onStorage);
  };
}

// The order success page is shared by cart checkouts and single-piece quick
// orders. A cart checkout notes (per tab) which items and quantities it sent
// to Stripe, and the success page subtracts only those, so a quick order never
// empties the cart and units added after checkout started stay in it. The cancelled page and the quick-order form clear the note.

/**
 * @param {{ sku: string, qty: number }[]} items
 * @param {string | null} sessionId the Stripe Checkout Session id
 * @param {Storage | null} [session]
 */
export function markCartCheckoutStarted(items, sessionId, session = defaultSessionStorage()) {
  try {
    session?.setItem(
      CART_CHECKOUT_KEY,
      JSON.stringify({ sessionId, items: items.map(({ sku, qty }) => ({ sku, qty })) })
    );
  } catch {
    // Without the note the cart just isn't emptied after payment.
  }
}

/** @param {Storage | null} [session] */
export function clearCartCheckoutMark(session = defaultSessionStorage()) {
  try {
    session?.removeItem(CART_CHECKOUT_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/**
 * Called on the order success page with its session_id: if it matches the
 * checkout this tab started, subtracts the quantities that checkout sent
 * (removing a line that reaches 0) and forgets the note, so a reload changes
 * nothing. Stripe adds session_id only after that checkout completes, so a
 * missing or different id (a quick order, or the page opened by hand)
 * changes nothing and keeps the note.
 * @param {string | null} sessionId
 * @param {Storage | null} [storage]
 * @param {Storage | null} [session]
 * @param {EventTarget | null} [target]
 */
export function completeCartCheckout(
  sessionId,
  storage = defaultStorage(),
  session = defaultSessionStorage(),
  target = defaultTarget()
) {
  let note;
  try {
    note = JSON.parse(session?.getItem(CART_CHECKOUT_KEY) ?? 'null');
  } catch {
    note = null;
  }
  if (!sessionId || !note || note.sessionId !== sessionId || !Array.isArray(note.items)) return;

  let cart = loadCart(storage);
  for (const entry of note.items) {
    if (!entry || typeof entry.sku !== 'string' || !Number.isInteger(entry.qty) || entry.qty < 1) continue;
    const line = cart.items.find((item) => item.sku === entry.sku);
    // Fewer units than were checked out means the line changed after
    // checkout started (e.g. removed, then re-added): leave those units.
    if (line && line.qty >= entry.qty) cart = setQuantity(cart, entry.sku, line.qty - entry.qty);
  }
  // Forget the note only once the cart is saved, so a reload can retry.
  if (saveCart(cart, storage, target)) clearCartCheckoutMark(session);
}
