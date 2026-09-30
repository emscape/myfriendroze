import { describe, it, expect } from 'vitest';
import {
  EMPTY_CART,
  MAX_CART_ITEMS,
  maxQtyForCategory,
  parseCart,
  serializeCart,
  addToCart,
  setQuantity,
  removeFromCart,
  cartItemCount,
  checkoutItems,
} from './cart.js';

function cartOf(items) {
  return { items };
}

describe('maxQtyForCategory', () => {
  it('allows up to 20 plants and one of each pottery or "other" piece', () => {
    expect(maxQtyForCategory('plant')).toBe(20);
    expect(maxQtyForCategory('pottery')).toBe(1);
    expect(maxQtyForCategory('other')).toBe(1);
  });

  it.each([undefined, null, '', 'mystery'])('treats category %j as pottery (limit 1)', (category) => {
    expect(maxQtyForCategory(category)).toBe(1);
  });
});

describe('addToCart', () => {
  it('adds a new product with the requested quantity', () => {
    const { cart, status } = addToCart(EMPTY_CART, { sku: 'p1', category: 'plant', qty: 3 });

    expect(status).toBe('added');
    expect(cart.items).toEqual([{ sku: 'p1', category: 'plant', qty: 3 }]);
  });

  it('defaults to a quantity of 1', () => {
    const { cart } = addToCart(EMPTY_CART, { sku: 'p1', category: 'plant' });

    expect(cart.items[0].qty).toBe(1);
  });

  it('adds to the quantity of a product already in the cart instead of listing it twice', () => {
    const start = cartOf([{ sku: 'p1', category: 'plant', qty: 2 }]);

    const { cart, status } = addToCart(start, { sku: 'p1', category: 'plant', qty: 3 });

    expect(status).toBe('added');
    expect(cart.items).toEqual([{ sku: 'p1', category: 'plant', qty: 5 }]);
  });

  it('caps the quantity at the category limit and reports it', () => {
    const start = cartOf([{ sku: 'p1', category: 'plant', qty: 18 }]);

    const { cart, status } = addToCart(start, { sku: 'p1', category: 'plant', qty: 5 });

    expect(status).toBe('limited');
    expect(cart.items[0].qty).toBe(20);
  });

  it('reports a one-of-a-kind piece that is already in the cart as limited', () => {
    const start = cartOf([{ sku: 'bowl', category: 'pottery', qty: 1 }]);

    const { cart, status } = addToCart(start, { sku: 'bowl', category: 'pottery' });

    expect(status).toBe('limited');
    expect(cart.items).toEqual([{ sku: 'bowl', category: 'pottery', qty: 1 }]);
  });

  it(`refuses a new product once the cart holds ${MAX_CART_ITEMS} different products`, () => {
    const full = cartOf(
      Array.from({ length: MAX_CART_ITEMS }, (_, i) => ({ sku: `s${i}`, category: 'pottery', qty: 1 }))
    );

    const { cart, status } = addToCart(full, { sku: 'one-more', category: 'pottery' });

    expect(status).toBe('full');
    expect(cart.items).toHaveLength(MAX_CART_ITEMS);
  });

  it('does not change the cart it was given', () => {
    const start = cartOf([{ sku: 'p1', category: 'plant', qty: 1 }]);

    addToCart(start, { sku: 'p1', category: 'plant', qty: 1 });
    addToCart(start, { sku: 'p2', category: 'plant', qty: 1 });

    expect(start.items).toEqual([{ sku: 'p1', category: 'plant', qty: 1 }]);
  });
});

describe('setQuantity', () => {
  const start = cartOf([
    { sku: 'p1', category: 'plant', qty: 2 },
    { sku: 'bowl', category: 'pottery', qty: 1 },
  ]);

  it('sets the quantity of a product in the cart', () => {
    expect(setQuantity(start, 'p1', 7).items[0].qty).toBe(7);
  });

  it('caps the quantity at the category limit', () => {
    expect(setQuantity(start, 'p1', 99).items[0].qty).toBe(20);
    expect(setQuantity(start, 'bowl', 3).items[1].qty).toBe(1);
  });

  it('removes the product when the quantity drops below 1', () => {
    expect(setQuantity(start, 'p1', 0).items.map((i) => i.sku)).toEqual(['bowl']);
  });

  it('leaves the cart unchanged for a sku that is not in it', () => {
    expect(setQuantity(start, 'nope', 3)).toEqual(start);
  });
});

describe('removeFromCart', () => {
  it('removes only the given product', () => {
    const start = cartOf([
      { sku: 'p1', category: 'plant', qty: 2 },
      { sku: 'bowl', category: 'pottery', qty: 1 },
    ]);

    expect(removeFromCart(start, 'p1').items).toEqual([{ sku: 'bowl', category: 'pottery', qty: 1 }]);
  });
});

describe('cartItemCount', () => {
  it('counts every unit, not just distinct products', () => {
    const cart = cartOf([
      { sku: 'p1', category: 'plant', qty: 3 },
      { sku: 'bowl', category: 'pottery', qty: 1 },
    ]);

    expect(cartItemCount(cart)).toBe(4);
    expect(cartItemCount(EMPTY_CART)).toBe(0);
  });
});

describe('checkoutItems', () => {
  it('reduces the cart to the sku/qty pairs the checkout API accepts', () => {
    const cart = cartOf([
      { sku: 'p1', category: 'plant', qty: 3 },
      { sku: 'bowl', category: 'pottery', qty: 1 },
    ]);

    expect(checkoutItems(cart)).toEqual([
      { sku: 'p1', qty: 3 },
      { sku: 'bowl', qty: 1 },
    ]);
  });
});

describe('parseCart / serializeCart', () => {
  it('round-trips a cart', () => {
    const cart = cartOf([
      { sku: 'p1', category: 'plant', qty: 3 },
      { sku: 'bowl', category: 'pottery', qty: 1 },
    ]);

    expect(parseCart(serializeCart(cart))).toEqual(cart);
  });

  // Stored carts come from the visitor's own browser storage, which can be
  // missing, corrupted, or edited by hand, so parsing never throws.
  it.each([null, '', 'not json', '42', '{"items":"nope"}', '[]'])(
    'treats unreadable stored data %j as an empty cart',
    (raw) => {
      expect(parseCart(raw)).toEqual(EMPTY_CART);
    }
  );

  it('drops malformed entries, clamps quantities, and merges repeated skus', () => {
    const raw = JSON.stringify({
      items: [
        { sku: 'p1', category: 'plant', qty: 50 },
        { sku: 'bowl', category: 'pottery', qty: 4 },
        { sku: '', category: 'plant', qty: 1 },
        { category: 'plant', qty: 1 },
        { sku: 'p2', category: 'plant', qty: 0 },
        { sku: 'p3', category: 'plant', qty: 'two' },
        { sku: 'p4', category: 'plant', qty: 2.5 },
        { sku: 'p1', category: 'plant', qty: 1 },
        null,
      ],
    });

    expect(parseCart(raw)).toEqual(
      cartOf([
        { sku: 'p1', category: 'plant', qty: 20 },
        { sku: 'bowl', category: 'pottery', qty: 1 },
      ])
    );
  });

  it(`keeps at most ${MAX_CART_ITEMS} products from stored data`, () => {
    const raw = JSON.stringify({
      items: Array.from({ length: MAX_CART_ITEMS + 5 }, (_, i) => ({ sku: `s${i}`, category: 'plant', qty: 1 })),
    });

    expect(parseCart(raw).items).toHaveLength(MAX_CART_ITEMS);
  });
});
