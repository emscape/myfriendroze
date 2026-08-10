/**
 * Constants used throughout the site
 */

// Breakpoints for responsive design
const BREAKPOINTS = {
  small: 'screen and (max-width: 749px)',
  medium: 'screen and (min-width: 750px) and (max-width: 989px)',
  large: 'screen and (min-width: 990px)',
};

// Animation timing
const ANIMATION = {
  defaultTiming: 300, // ms
  slideTiming: 500, // ms
};

// DOM selectors
const SELECTORS = {
  customerAddresses: '[data-customer-addresses]',
  announcementBar: '[data-announcement-bar]',
  cartDrawer: '[data-cart-drawer]',
  cartItems: '[data-cart-items]',
  header: '[data-header]',
  menu: '[data-menu]',
  menuToggle: '[data-menu-toggle]',
  searchToggle: '[data-search-toggle]',
  searchForm: '[data-search-form]',
  predictiveSearch: '[data-predictive-search]',
};

// Export constants
if (typeof window !== 'undefined') {
  window.BREAKPOINTS = BREAKPOINTS;
  window.ANIMATION = ANIMATION;
  window.SELECTORS = SELECTORS;
}