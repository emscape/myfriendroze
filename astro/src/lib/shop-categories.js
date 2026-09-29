// The site's shop pages, one per product category. `value` is what the
// admin app (myfriendroze-app, lib/models/product_category.dart) stores in
// a product doc's `category` field; `path` is the listing page; `label` is
// the name shown in the header's "shops" dropdown and as the page heading.
// Order here is the dropdown order.
//
// pages/shop/[...category].astro serves all three: the bare /shop route
// (no slug) is pottery, so links to /shop from before the split keep
// landing on the same products.

/**
 * @typedef {{ value: string, slug: string | undefined, path: string,
 *   label: string, pageTitle: string, pageDescription: string }} ShopCategory
 */

/** @type {ShopCategory[]} */
export const SHOP_CATEGORIES = [
  {
    value: 'pottery',
    slug: undefined,
    path: '/shop',
    label: "you're kiln me",
    pageTitle: 'Shop | myfriendroze Ceramics',
    pageDescription:
      'Shop handcrafted ceramic planters and unique pottery pieces from myfriendroze ceramics. Each piece is lovingly made by hand.',
  },
  {
    value: 'plant',
    slug: 'plants',
    path: '/shop/plants',
    label: 'dd succulents',
    pageTitle: 'dd succulents | myfriendroze',
    pageDescription: 'Shop succulents and other plants from myfriendroze.',
  },
  {
    value: 'other',
    slug: 'other',
    path: '/shop/other',
    label: 'the rest of my madness',
    pageTitle: 'the rest of my madness | myfriendroze',
    pageDescription: 'Shop one-of-a-kind pieces from myfriendroze beyond pottery and plants.',
  },
];

const DEFAULT_CATEGORY = SHOP_CATEGORIES[0];

/**
 * A missing or unrecognised category is listed as pottery: every product
 * created before the admin app had a category picker is pottery, and
 * hiding a product the admin app shows as active would be worse than
 * listing it on the wrong page.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeCategory(raw) {
  return SHOP_CATEGORIES.some((c) => c.value === raw) ? /** @type {string} */ (raw) : DEFAULT_CATEGORY.value;
}

/**
 * The shop for a [...category] route param: undefined (bare /shop) is
 * pottery; anything that isn't a known slug is null, so the page can 404.
 * @param {string | undefined} slug
 * @returns {ShopCategory | null}
 */
export function shopCategoryForSlug(slug) {
  return SHOP_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

/**
 * The shop a product is listed on, e.g. for its detail page's breadcrumb.
 * @param {unknown} value
 * @returns {ShopCategory}
 */
export function shopCategoryForValue(value) {
  const normalized = normalizeCategory(value);
  return SHOP_CATEGORIES.find((c) => c.value === normalized) ?? DEFAULT_CATEGORY;
}

/**
 * @template {{ category: string }} T
 * @param {T[]} products
 * @param {string} value
 * @returns {T[]}
 */
export function productsInCategory(products, value) {
  return products.filter((p) => p.category === value);
}
