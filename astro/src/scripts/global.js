/**
 * Global JavaScript for the site
 * Handles common functionality across all pages
 */

// Wait until DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initializeHeader();
  initializeMenuToggle();
  initializeAccessibility();
});

/**
 * Initialize header functionality
 */
function initializeHeader() {
  const header = document.querySelector(SELECTORS.header);
  if (!header) return;

  // Handle header scroll behavior
  let lastScrollTop = 0;
  
  window.addEventListener('scroll', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    if (scrollTop > lastScrollTop && scrollTop > 100) {
      // Scrolling down
      header.classList.add('header--hidden');
    } else {
      // Scrolling up
      header.classList.remove('header--hidden');
    }
    
    lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
  }, { passive: true });
}

/**
 * Initialize menu toggle functionality
 */
function initializeMenuToggle() {
  const menuToggle = document.querySelector(SELECTORS.menuToggle);
  const menu = document.querySelector(SELECTORS.menu);
  
  if (!menuToggle || !menu) return;
  
  menuToggle.addEventListener('click', () => {
    const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', !expanded);
    menu.classList.toggle('menu--visible');
    
    // Prevent body scroll when menu is open
    document.body.classList.toggle('overflow-hidden');
  });
}

/**
 * Initialize accessibility features
 */
function initializeAccessibility() {
  // Handle skip to content link
  const skipLink = document.querySelector('.skip-to-content-link');
  if (skipLink) {
    skipLink.addEventListener('click', (event) => {
      event.preventDefault();
      const target = document.querySelector(skipLink.getAttribute('href'));
      if (target) {
        target.tabIndex = -1;
        target.focus();
      }
    });
  }
  
  // Add focus outline for keyboard navigation
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      document.body.classList.add('user-is-tabbing');
    }
  });
  
  document.addEventListener('mousedown', () => {
    document.body.classList.remove('user-is-tabbing');
  });
}