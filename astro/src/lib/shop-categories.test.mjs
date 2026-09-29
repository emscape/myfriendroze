import { describe, it, expect } from 'vitest';
import {
  SHOP_CATEGORIES,
  normalizeCategory,
  shopCategoryForSlug,
  shopCategoryForValue,
  productsInCategory,
} from './shop-categories.js';

describe('SHOP_CATEGORIES', () => {
  it('lists the three shops in header order with the values the admin app stores', () => {
    expect(SHOP_CATEGORIES.map((c) => [c.value, c.path, c.label])).toEqual([
      ['pottery', '/shop', "you're kiln me"],
      ['plant', '/shop/plants', 'dd succulents'],
      ['other', '/shop/other', 'the rest of my madness'],
    ]);
  });
});

describe('normalizeCategory', () => {
  it('keeps each known category value', () => {
    expect(normalizeCategory('pottery')).toBe('pottery');
    expect(normalizeCategory('plant')).toBe('plant');
    expect(normalizeCategory('other')).toBe('other');
  });

  it('treats a missing category as pottery (every pre-category product is pottery)', () => {
    expect(normalizeCategory(undefined)).toBe('pottery');
    expect(normalizeCategory(null)).toBe('pottery');
    expect(normalizeCategory('')).toBe('pottery');
  });

  it('treats an unrecognised or non-string category as pottery rather than hiding the product', () => {
    expect(normalizeCategory('jewelry')).toBe('pottery');
    expect(normalizeCategory('Plant')).toBe('pottery');
    expect(normalizeCategory(42)).toBe('pottery');
  });
});

describe('shopCategoryForSlug', () => {
  it('maps the bare /shop route (no slug) to pottery', () => {
    expect(shopCategoryForSlug(undefined)?.value).toBe('pottery');
  });

  it('maps each sub-page slug to its category', () => {
    expect(shopCategoryForSlug('plants')?.value).toBe('plant');
    expect(shopCategoryForSlug('other')?.value).toBe('other');
  });

  it('returns null for an unknown slug, so the page can 404', () => {
    expect(shopCategoryForSlug('pottery')).toBeNull();
    expect(shopCategoryForSlug('plant')).toBeNull();
    expect(shopCategoryForSlug('plants/extra')).toBeNull();
    expect(shopCategoryForSlug('')).toBeNull();
  });
});

describe('shopCategoryForValue', () => {
  it('returns the shop for a product category, defaulting to pottery', () => {
    expect(shopCategoryForValue('plant').path).toBe('/shop/plants');
    expect(shopCategoryForValue(undefined).path).toBe('/shop');
  });
});

describe('productsInCategory', () => {
  const products = [
    { id: 'a', category: 'pottery' },
    { id: 'b', category: 'plant' },
    { id: 'c', category: 'other' },
    { id: 'd', category: 'plant' },
  ];

  it('keeps only products in the requested category, in their original order', () => {
    expect(productsInCategory(products, 'plant').map((p) => p.id)).toEqual(['b', 'd']);
    expect(productsInCategory(products, 'pottery').map((p) => p.id)).toEqual(['a']);
    expect(productsInCategory(products, 'other').map((p) => p.id)).toEqual(['c']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(productsInCategory([{ id: 'a', category: 'pottery' }], 'other')).toEqual([]);
  });
});
