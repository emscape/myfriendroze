// Product data for myfriendroze ceramics
// This data is derived from the products_export.csv file
// In a real application, this would come from a CMS or database

export const products = [
  {
    id: 'blue-branches',
    handle: 'blue-branches',
    title: 'Blue Branches',
    description: 'Welcome to your blue period…or purple it\'s hard to tell. 4.5" across by 4.75" tall with drainage holes, your succulent cacti or houseplant won\'t be blue living here.',
    price: 70.00,
    compareAtPrice: null,
    images: [
      'https://cdn.shopify.com/s/files/1/0781/7697/7186/files/IMG_1655.jpg?v=1699123183',
      'https://cdn.shopify.com/s/files/1/0781/7697/7186/files/PhotoRoom_20231104_115021.jpg?v=1699124106',
      'https://cdn.shopify.com/s/files/1/0781/7697/7186/files/5AE0FE3E-27D8-4B69-934C-BBC36AA68637.jpg?v=1699124105',
      'https://cdn.shopify.com/s/files/1/0781/7697/7186/files/8ABF0071-0136-4FAE-9D66-FF38DADD63D2.jpg?v=1699124106',
      'https://cdn.shopify.com/s/files/1/0781/7697/7186/files/EA819A6F-F7CA-41C7-AD13-FDB8832CDC45.jpg?v=1699124106',
      'https://cdn.shopify.com/s/files/1/0781/7697/7186/files/IMG_2579.jpg?v=1699124105'
    ],
    tags: ['you\'re kiln me'],
    inStock: true,
    category: 'Planters',
    dimensions: '4.5" W × 4.75" H',
    features: ['Drainage holes', 'Handcrafted ceramic', 'Food-safe glaze'],
    weight: 1360.77711, // grams from CSV
    seoTitle: 'Blue Branches Ceramic Planter | myfriendroze',
    seoDescription: 'Handcrafted blue ceramic planter with drainage holes. Perfect for succulents, cacti, or houseplants. 4.5" across by 4.75" tall.'
  },
  {
    id: 'medium-yellow-lined-planter',
    handle: 'medium-yellow-lined-planter',
    title: 'Medium Yellow Lined Planter',
    description: 'Yellow bellied but not a coward, this 5" x 5" planter with drainage will make a happy home for anything you desire...well anything plant related- I\'d keep your cats out of it.',
    price: 75.00,
    compareAtPrice: null,
    images: [
      'https://cdn.shopify.com/s/files/1/0781/7697/7186/files/PhotoRoom_20230724_194437.png?v=1690253194'
    ],
    tags: ['you\'re kiln me'],
    inStock: true,
    category: 'Planters',
    dimensions: '5" W × 5" H',
    features: ['Drainage holes', 'Handcrafted ceramic', 'Yellow lined interior', 'Food-safe glaze'],
    weight: 1814.36948, // grams from CSV
    seoTitle: 'Medium Yellow Lined Ceramic Planter | myfriendroze',
    seoDescription: 'Handcrafted ceramic planter with yellow lined interior and drainage holes. Perfect for medium-sized plants. 5" x 5" size.'
  },
  {
    id: 'pineapple-planter',
    handle: 'pineapple-planter',
    title: 'Pineapple Planter',
    description: '4.5" x 4.5" (bigger in the middle - like many of us) blue black green - planter only',
    price: 75.00,
    compareAtPrice: null,
    images: [
      'https://cdn.shopify.com/s/files/1/0781/7697/7186/files/IMG-0481.jpg?v=1714680777',
      'https://cdn.shopify.com/s/files/1/0781/7697/7186/files/IMG-0480.jpg?v=1714680777'
    ],
    tags: [],
    inStock: true,
    category: 'Planters',
    dimensions: '4.5" W × 4.5" H (wider in middle)',
    features: ['Unique pineapple shape', 'Handcrafted ceramic', 'Blue-black-green glaze', 'Drainage holes'],
    weight: 2267.96185, // grams from CSV
    seoTitle: 'Pineapple Shaped Ceramic Planter | myfriendroze',
    seoDescription: 'Unique pineapple-shaped ceramic planter in blue-black-green glaze. Handcrafted with drainage holes. 4.5" x 4.5" size.'
  }
];

// Helper functions for working with products
export function getProductByHandle(handle) {
  return products.find(product => product.handle === handle);
}

export function getProductById(id) {
  return products.find(product => product.id === id);
}

export function getProductsByCategory(category) {
  return products.filter(product => product.category === category);
}

export function getInStockProducts() {
  return products.filter(product => product.inStock);
}

export function getProductsByTag(tag) {
  return products.filter(product => product.tags.includes(tag));
}

export function getFeaturedProducts(limit = 3) {
  // For now, just return the first few products
  // In a real app, you might have a featured flag
  return products.slice(0, limit);
}

// Product categories
export const categories = [
  {
    id: 'planters',
    name: 'Planters',
    description: 'Handcrafted ceramic planters for your favorite plants'
  }
];

// Product tags
export const tags = [
  {
    id: 'youre-kiln-me',
    name: 'you\'re kiln me',
    description: 'Our signature collection with playful ceramic puns'
  }
];

export default products;
