import { describe, it, expect } from 'vitest';
import { docToProduct, dedupeHandles } from './fetch-products.mjs';

function fakeDoc(id, data) {
  return { id, data: () => data };
}

describe('docToProduct', () => {
  it('maps core fields from Firestore product data', () => {
    const doc = fakeDoc('aBc123', {
      title: 'Blue Branches',
      description: 'A blue ceramic planter.',
      price: 70,
      weight: 1360.77711,
      imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      isActive: true,
    });

    const product = docToProduct(doc);

    expect(product.title).toBe('Blue Branches');
    expect(product.description).toBe('A blue ceramic planter.');
    expect(product.price).toBe(70);
    expect(product.weight).toBe(1360.77711);
    expect(product.images).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ]);
  });

  it('sources id from doc.id, not from the document data', () => {
    const doc = fakeDoc('the-real-id', {
      id: 'a-decoy-id-in-the-data',
      title: 'Decoy Product',
      price: 10,
    });

    const product = docToProduct(doc);

    expect(product.id).toBe('the-real-id');
  });

  it('derives a slugified handle from the title', () => {
    const doc = fakeDoc('abc', { title: 'Blue Branches', price: 70 });

    const product = docToProduct(doc);

    expect(product.handle).toBe('blue-branches');
  });

  it('slugifies titles with punctuation and mixed case', () => {
    const doc = fakeDoc('abc', {
      title: "You're Kiln Me!! Medium Planter",
      price: 40,
    });

    const product = docToProduct(doc);

    expect(product.handle).toBe('youre-kiln-me-medium-planter');
  });

  it('falls back to the single imageUrl field when imageUrls is absent', () => {
    const doc = fakeDoc('abc', {
      title: 'Fallback Image Product',
      price: 20,
      imageUrl: 'https://example.com/single.jpg',
    });

    const product = docToProduct(doc);

    expect(product.images).toEqual(['https://example.com/single.jpg']);
  });

  it('defaults images to an empty array when neither field is present', () => {
    const doc = fakeDoc('abc', { title: 'No Image Product', price: 5 });

    const product = docToProduct(doc);

    expect(product.images).toEqual([]);
  });

  it('defaults category, dimensions, features, tags, and compareAtPrice for fields Firestore does not store', () => {
    // The Flutter admin app's Product model has no category/dimensions/
    // features/tags/compareAtPrice fields today — this is a known data-
    // completeness gap (see admin-app-web-hosting memory / project backlog),
    // not something this script should invent data for. Everything must
    // default to a safe, renderable empty value rather than being undefined.
    const doc = fakeDoc('abc', { title: 'Bare Product', price: 15 });

    const product = docToProduct(doc);

    expect(product.category).toBe('');
    expect(product.dimensions).toBe('');
    expect(product.features).toEqual([]);
    expect(product.tags).toEqual([]);
    expect(product.compareAtPrice).toBeNull();
  });

  it('defaults price and weight to 0 when missing, never undefined', () => {
    const doc = fakeDoc('abc', { title: 'No Price Product' });

    const product = docToProduct(doc);

    expect(product.price).toBe(0);
    expect(product.weight).toBe(0);
  });

  // inStock is a distinct concept from isActive: isActive controls whether
  // a product is fetched/shown on the site at all (see the isActive==true
  // Firestore query in main()); inStock controls whether a *visible*
  // product can be purchased (shows a "Sold Out" badge/disabled button
  // instead of disappearing entirely). Conflating them (inStock derived
  // from isActive) was the bug — it made "visible but sold out" not
  // representable at all.
  it('defaults inStock to true when the field is absent', () => {
    const doc = fakeDoc('abc', { title: 'No Stock Field Product', price: 10, isActive: true });

    const product = docToProduct(doc);

    expect(product.inStock).toBe(true);
  });

  it('reads inStock from its own Firestore field, independent of isActive — a visible (isActive: true) product can still be sold out', () => {
    const doc = fakeDoc('abc', {
      title: 'Sold Out But Visible',
      price: 10,
      isActive: true,
      inStock: false,
    });

    const product = docToProduct(doc);

    expect(product.inStock).toBe(false);
  });
});

describe('dedupeHandles', () => {
  it('leaves unique handles untouched', () => {
    const products = [
      { id: '1', handle: 'blue-branches' },
      { id: '2', handle: 'yellow-planter' },
    ];

    const result = dedupeHandles(products);

    expect(result.map((p) => p.handle)).toEqual([
      'blue-branches',
      'yellow-planter',
    ]);
  });

  it('disambiguates duplicate handles with a suffix derived from doc id', () => {
    const products = [
      { id: 'aaaa1111', handle: 'planter' },
      { id: 'bbbb2222', handle: 'planter' },
    ];

    const result = dedupeHandles(products);

    expect(result[0].handle).toBe('planter');
    expect(result[1].handle).toBe('planter-2222');
    // Never produces a second collision either.
    expect(new Set(result.map((p) => p.handle)).size).toBe(2);
  });

  it('handles three-way collisions distinctly', () => {
    const products = [
      { id: '1111aaaa', handle: 'planter' },
      { id: '2222bbbb', handle: 'planter' },
      { id: '3333cccc', handle: 'planter' },
    ];

    const result = dedupeHandles(products);

    expect(new Set(result.map((p) => p.handle)).size).toBe(3);
  });
});
