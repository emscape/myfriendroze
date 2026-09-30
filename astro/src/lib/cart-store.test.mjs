import { describe, it, expect, vi } from 'vitest';
import {
  CART_STORAGE_KEY,
  CART_CHANGED_EVENT,
  loadCart,
  saveCart,
  onCartChange,
  markCartCheckoutStarted,
  clearCartCheckoutMark,
  completeCartCheckout,
} from './cart-store.js';
import { EMPTY_CART, serializeCart } from './cart.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

// Browsers throw from localStorage in some private-browsing modes and when
// site data is blocked; the cart must degrade to empty rather than break
// the page.
function throwingStorage() {
  return {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };
}

const CART = { items: [{ sku: 'p1', category: 'plant', qty: 2 }] };

describe('loadCart', () => {
  it('reads the stored cart', () => {
    const storage = fakeStorage({ [CART_STORAGE_KEY]: serializeCart(CART) });

    expect(loadCart(storage)).toEqual(CART);
  });

  it('returns an empty cart when nothing is stored', () => {
    expect(loadCart(fakeStorage())).toEqual(EMPTY_CART);
  });

  it('returns an empty cart when storage is unavailable', () => {
    expect(loadCart(throwingStorage())).toEqual(EMPTY_CART);
    expect(loadCart(null)).toEqual(EMPTY_CART);
  });
});

describe('saveCart', () => {
  it('stores the cart and announces the new item count', () => {
    const storage = fakeStorage();
    const target = new EventTarget();
    const listener = vi.fn();
    target.addEventListener(CART_CHANGED_EVENT, listener);

    const saved = saveCart(CART, storage, target);

    expect(saved).toBe(true);
    expect(loadCart(storage)).toEqual(CART);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ count: 2 });
  });

  it('reports failure instead of throwing when storage is unavailable', () => {
    const target = new EventTarget();
    const listener = vi.fn();
    target.addEventListener(CART_CHANGED_EVENT, listener);

    expect(saveCart(CART, throwingStorage(), target)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('onCartChange', () => {
  it('calls back with the cart after a save on this page', () => {
    const storage = fakeStorage();
    const target = new EventTarget();
    const callback = vi.fn();
    onCartChange(callback, storage, target);

    saveCart(CART, storage, target);

    expect(callback).toHaveBeenCalledWith(CART);
  });

  // The browser fires "storage" on other open tabs when one tab saves.
  it('calls back when another tab changes the stored cart, ignoring other keys', () => {
    const storage = fakeStorage({ [CART_STORAGE_KEY]: serializeCart(CART) });
    const target = new EventTarget();
    const callback = vi.fn();
    onCartChange(callback, storage, target);

    const otherKey = new Event('storage');
    otherKey.key = 'something-else';
    target.dispatchEvent(otherKey);
    const cartKey = new Event('storage');
    cartKey.key = CART_STORAGE_KEY;
    target.dispatchEvent(cartKey);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(CART);
  });

  it('stops calling back after unsubscribing', () => {
    const storage = fakeStorage();
    const target = new EventTarget();
    const callback = vi.fn();
    const unsubscribe = onCartChange(callback, storage, target);

    unsubscribe();
    saveCart(CART, storage, target);

    expect(callback).not.toHaveBeenCalled();
  });
});

// The order success page is shared by cart checkouts and single-piece quick
// orders, so the cart remembers (per tab) which items it sent to Stripe and
// removes only those once payment succeeds.
describe('cart checkout completion', () => {
  const TWO = {
    items: [
      { sku: 'p1', category: 'plant', qty: 2 },
      { sku: 'bowl', category: 'pottery', qty: 1 },
    ],
  };

  it('removes the checked-out items from the cart after a successful cart checkout', () => {
    const storage = fakeStorage({ [CART_STORAGE_KEY]: serializeCart(TWO) });
    const session = fakeStorage();

    markCartCheckoutStarted([{ sku: 'p1', qty: 2 }], 'cs_1', session);
    completeCartCheckout('cs_1', storage, session, new EventTarget());

    expect(loadCart(storage).items.map((i) => i.sku)).toEqual(['bowl']);
  });

  // e.g. 3 plants were checked out, then 2 more added in another tab
  // before paying: only the 3 that were bought come out of the cart.
  it('subtracts only the checked-out quantity from a line', () => {
    const storage = fakeStorage({
      [CART_STORAGE_KEY]: serializeCart({ items: [{ sku: 'p1', category: 'plant', qty: 5 }] }),
    });
    const session = fakeStorage();

    markCartCheckoutStarted([{ sku: 'p1', qty: 3 }], 'cs_1', session);
    completeCartCheckout('cs_1', storage, session, new EventTarget());

    expect(loadCart(storage).items).toEqual([{ sku: 'p1', category: 'plant', qty: 2 }]);
  });

  it('ignores malformed entries in the checkout note', () => {
    const storage = fakeStorage({ [CART_STORAGE_KEY]: serializeCart(TWO) });
    const session = fakeStorage();
    session.setItem(
      'myfriendroze-cart-checkout',
      JSON.stringify({
        sessionId: 'cs_1',
        items: [null, 'p1', { sku: 'p1' }, { sku: 'p1', qty: 0 }, { sku: 'bowl', qty: 1 }],
      })
    );

    completeCartCheckout('cs_1', storage, session, new EventTarget());

    expect(loadCart(storage).items).toEqual([{ sku: 'p1', category: 'plant', qty: 2 }]);
  });

  // Stripe adds session_id to the success link only after that checkout
  // completes, so a mismatched or missing id means this tab's checkout
  // wasn't the one that was paid (e.g. the page was opened by hand).
  it.each([['cs_other'], [null], ['']])("changes nothing when the success link's session id is %j", (sessionId) => {
    const storage = fakeStorage({ [CART_STORAGE_KEY]: serializeCart(TWO) });
    const session = fakeStorage();
    markCartCheckoutStarted([{ sku: 'p1', qty: 2 }], 'cs_1', session);

    completeCartCheckout(sessionId, storage, session, new EventTarget());

    expect(loadCart(storage)).toEqual(TWO);
    // The note is kept, so the real success page can still complete it.
    completeCartCheckout('cs_1', storage, session, new EventTarget());
    expect(loadCart(storage).items.map((i) => i.sku)).toEqual(['bowl']);
  });

  // Fewer units than were checked out means the line changed after
  // checkout started (e.g. removed, then re-added): those units are new.
  it('leaves a line alone when it now holds fewer units than were checked out', () => {
    const storage = fakeStorage({
      [CART_STORAGE_KEY]: serializeCart({ items: [{ sku: 'p1', category: 'plant', qty: 2 }] }),
    });
    const session = fakeStorage();
    markCartCheckoutStarted([{ sku: 'p1', qty: 3 }], 'cs_1', session);

    completeCartCheckout('cs_1', storage, session, new EventTarget());

    expect(loadCart(storage).items).toEqual([{ sku: 'p1', category: 'plant', qty: 2 }]);
  });

  it('keeps the checkout note when the cart cannot be saved, so a reload can retry', () => {
    const readOnly = fakeStorage({ [CART_STORAGE_KEY]: serializeCart(TWO) });
    readOnly.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const session = fakeStorage();
    markCartCheckoutStarted([{ sku: 'p1', qty: 2 }], 'cs_1', session);

    completeCartCheckout('cs_1', readOnly, session, new EventTarget());

    expect(session.getItem('myfriendroze-cart-checkout')).not.toBeNull();
  });

  it('only runs once: a second success-page load changes nothing', () => {
    const storage = fakeStorage({ [CART_STORAGE_KEY]: serializeCart(TWO) });
    const session = fakeStorage();
    markCartCheckoutStarted([{ sku: 'p1', qty: 2 }], 'cs_1', session);
    completeCartCheckout('cs_1', storage, session, new EventTarget());

    saveCart(TWO, storage, new EventTarget());
    completeCartCheckout('cs_1', storage, session, new EventTarget());

    expect(loadCart(storage)).toEqual(TWO);
  });

  it('leaves the cart alone after a quick order (no cart checkout was started)', () => {
    const storage = fakeStorage({ [CART_STORAGE_KEY]: serializeCart(TWO) });

    completeCartCheckout('cs_1', storage, fakeStorage(), new EventTarget());

    expect(loadCart(storage)).toEqual(TWO);
  });

  it('leaves the cart alone once a started checkout was cleared (cancelled)', () => {
    const storage = fakeStorage({ [CART_STORAGE_KEY]: serializeCart(TWO) });
    const session = fakeStorage();

    markCartCheckoutStarted([{ sku: 'p1', qty: 2 }], 'cs_1', session);
    clearCartCheckoutMark(session);
    completeCartCheckout('cs_1', storage, session, new EventTarget());

    expect(loadCart(storage)).toEqual(TWO);
  });

  it('ignores an unreadable checkout mark and never throws when storage is unavailable', () => {
    const storage = fakeStorage({ [CART_STORAGE_KEY]: serializeCart(TWO) });
    const session = fakeStorage();
    session.setItem('myfriendroze-cart-checkout', 'not json');

    expect(() => completeCartCheckout('cs_1', storage, session, new EventTarget())).not.toThrow();
    expect(loadCart(storage)).toEqual(TWO);
    expect(() => markCartCheckoutStarted([{ sku: 'p1', qty: 1 }], 'cs_1', throwingStorage())).not.toThrow();
    expect(() => clearCartCheckoutMark(throwingStorage())).not.toThrow();
    expect(() => completeCartCheckout('cs_1', throwingStorage(), throwingStorage(), new EventTarget())).not.toThrow();
  });
});
