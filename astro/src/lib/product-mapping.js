// Pure Firestore-doc -> Product transforms, shared by both the build-time
// snapshot script (scripts/fetch-products.mjs) and the live/on-demand
// Firestore reads used by shop.astro and products/[handle].astro. Moved
// here (out of fetch-products.mjs, which re-exports these for backward
// compatibility with its existing tests) so both paths use one definition
// instead of two copies drifting apart.

/**
 * Lowercases, strips punctuation, and hyphenates a title into a URL-safe
 * slug — matches the convention the old hand-written products.js already
 * used for its `handle` values (e.g. "Blue Branches" -> "blue-branches"),
 * since Firestore's product docs have no handle field of their own.
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  return (title || '')
    .toLowerCase()
    .replace(/['’]/g, '') // contractions collapse: "you're" -> "youre"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Pure transform from a Firestore product document to the shape
 * astro/src/data/products.js's Product typedef expects. No Firestore calls
 * here — unit-testable without a live database.
 *
 * category/dimensions/features/tags/compareAtPrice default to safe empty
 * values rather than being invented — the Flutter admin app's Product model
 * doesn't collect those fields today, a known gap tracked separately, not
 * something to paper over with guessed data here.
 * @param {{ id: string, data: () => Record<string, any> }} doc
 */
export function docToProduct(doc) {
  const data = doc.data();
  const images = Array.isArray(data.imageUrls) && data.imageUrls.length > 0
    ? data.imageUrls
    : data.imageUrl
      ? [data.imageUrl]
      : [];

  return {
    id: doc.id,
    handle: slugify(data.title),
    title: data.title || '',
    description: data.description || '',
    price: typeof data.price === 'number' ? data.price : 0,
    compareAtPrice: null,
    images,
    tags: [],
    // inStock is distinct from isActive: isActive gates whether the
    // product is fetched/shown at all (the Firestore query itself filters
    // on it); inStock is a visible-but-sold-out signal for products that
    // are still active. Defaults to true only when the field is genuinely
    // absent, so existing products with no inStock field set keep behaving
    // as purchasable with no migration needed — but a *present* value that
    // isn't a real boolean fails safe to false (out of stock), matching
    // firebase/functions/lib/pricing.js's checkout-boundary check. Without
    // this, a malformed doc could show as purchasable here while checkout
    // correctly rejects the very same doc as out of stock.
    // (Not derived from isActive at all, strict or otherwise — a doc that
    // reaches this point is already isActive by construction, since every
    // real caller queries where('isActive', '==', true) first.)
    inStock: data.inStock === undefined ? true : data.inStock === true,
    category: '',
    dimensions: '',
    features: [],
    weight: typeof data.weight === 'number' ? data.weight : 0,
    seoTitle: '',
    seoDescription: '',
  };
}

/**
 * Disambiguates handle collisions (two products slugifying to the same
 * title) by suffixing every collision after the first with a short chunk
 * of its own Firestore doc id. Without this, two products sharing a handle
 * would collide at lookup time instead of erroring loudly.
 * @param {ReturnType<typeof docToProduct>[]} products
 */
export function dedupeHandles(products) {
  const seen = new Map();
  return products.map((product) => {
    const count = seen.get(product.handle) || 0;
    seen.set(product.handle, count + 1);
    if (count === 0) return product;
    const suffix = product.id.slice(-4);
    return { ...product, handle: `${product.handle}-${suffix}` };
  });
}
