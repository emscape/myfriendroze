import { describe, it, expect } from 'vitest';
import { buildCartView, catalogForCart, formatPrice } from './cart-view.js';

const PRODUCTS = [
  { id: 'bowl', handle: 'speckled-bowl', title: 'Speckled Bowl', price: 48, images: ['/bowl.png', '/bowl2.png'], inStock: true, category: 'pottery' },
  { id: 'eche', handle: 'echeveria', title: 'Echeveria', price: 12.5, images: [], inStock: true, category: 'plant' },
  { id: 'vase', handle: 'sold-vase', title: 'Sold Vase', price: 90, images: ['/vase.png'], inStock: false, category: 'pottery' },
];

function cartOf(items) {
  return { items };
}

describe('catalogForCart', () => {
  it('keeps only the fields the cart page needs, with the first image', () => {
    expect(catalogForCart(PRODUCTS)).toEqual([
      { id: 'bowl', handle: 'speckled-bowl', title: 'Speckled Bowl', price: 48, image: '/bowl.png', inStock: true, category: 'pottery' },
      { id: 'eche', handle: 'echeveria', title: 'Echeveria', price: 12.5, image: '', inStock: true, category: 'plant' },
      { id: 'vase', handle: 'sold-vase', title: 'Sold Vase', price: 90, image: '/vase.png', inStock: false, category: 'pottery' },
    ]);
  });
});

describe('buildCartView', () => {
  const catalog = catalogForCart(PRODUCTS);

  it('prices each line and the subtotal from the live catalog, in cents', () => {
    const view = buildCartView(
      cartOf([
        { sku: 'bowl', category: 'pottery', qty: 1 },
        { sku: 'eche', category: 'plant', qty: 3 },
      ]),
      catalog
    );

    expect(view.lines.map((l) => [l.sku, l.title, l.qty, l.priceCents, l.lineTotalCents, l.status])).toEqual([
      ['bowl', 'Speckled Bowl', 1, 4800, 4800, 'ok'],
      ['eche', 'Echeveria', 3, 1250, 3750, 'ok'],
    ]);
    expect(view.subtotalCents).toBe(8550);
    expect(view.checkoutItems).toEqual([
      { sku: 'bowl', qty: 1 },
      { sku: 'eche', qty: 3 },
    ]);
    expect(view.hasProblems).toBe(false);
  });

  it('includes each line’s link, image and quantity limit', () => {
    const [bowl, eche] = buildCartView(
      cartOf([
        { sku: 'bowl', category: 'pottery', qty: 1 },
        { sku: 'eche', category: 'plant', qty: 1 },
      ]),
      catalog
    ).lines;

    expect([bowl.href, bowl.image, bowl.maxQty]).toEqual(['/products/speckled-bowl', '/bowl.png', 1]);
    expect([eche.href, eche.image, eche.maxQty]).toEqual(['/products/echeveria', '', 20]);
  });

  // The live category decides the limit, not whatever was stored when the
  // piece was added (it may have been recategorised since).
  it('caps a stored quantity at the live category limit', () => {
    const view = buildCartView(cartOf([{ sku: 'bowl', category: 'plant', qty: 5 }]), catalog);

    expect(view.lines[0].qty).toBe(1);
    expect(view.checkoutItems).toEqual([{ sku: 'bowl', qty: 1 }]);
  });

  it('flags a sold-out piece and leaves it out of the checkout and subtotal', () => {
    const view = buildCartView(
      cartOf([
        { sku: 'bowl', category: 'pottery', qty: 1 },
        { sku: 'vase', category: 'pottery', qty: 1 },
      ]),
      catalog
    );

    expect(view.lines[1]).toMatchObject({ sku: 'vase', title: 'Sold Vase', status: 'sold-out' });
    expect(view.subtotalCents).toBe(4800);
    expect(view.checkoutItems).toEqual([{ sku: 'bowl', qty: 1 }]);
    expect(view.hasProblems).toBe(true);
  });

  // Inactive, deleted and not-yet-published products are all absent from
  // the live catalog.
  it('flags a piece missing from the live catalog as unavailable', () => {
    const view = buildCartView(cartOf([{ sku: 'gone', category: 'pottery', qty: 1 }]), catalog);

    expect(view.lines[0]).toMatchObject({ sku: 'gone', status: 'unavailable', href: null, lineTotalCents: 0 });
    expect(view.lines[0].title).toMatch(/no longer available/i);
    expect(view.checkoutItems).toEqual([]);
    expect(view.hasProblems).toBe(true);
  });

  it('describes an empty cart', () => {
    expect(buildCartView({ items: [] }, catalog)).toEqual({
      lines: [],
      subtotalCents: 0,
      checkoutItems: [],
      hasProblems: false,
    });
  });
});

describe('formatPrice', () => {
  it('formats cents as US dollars', () => {
    expect(formatPrice(8550)).toBe('$85.50');
    expect(formatPrice(0)).toBe('$0.00');
    expect(formatPrice(123456)).toBe('$1,234.56');
  });
});
