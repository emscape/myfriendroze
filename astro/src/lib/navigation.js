// Active-state logic for Header.astro's `navigation` array, kept out of
// the component so it's unit-testable.

/**
 * @typedef {{ href: string, label?: string }} NavLink
 * @typedef {{ label?: string, children: NavLink[] }} NavDropdown
 */

/**
 * A plain link is active on an exact path match; a dropdown is active when
 * the current page is any one of its children.
 * @param {NavLink | NavDropdown} item
 * @param {string} currentPath
 * @returns {boolean}
 */
export function isNavItemActive(item, currentPath) {
  if ('children' in item) {
    return item.children.some((child) => child.href === currentPath);
  }
  return item.href === currentPath;
}

/**
 * Whether `href` is the page actually being viewed, for aria-current.
 * Distinct from the highlight: Header's currentPath can name a section
 * (a product page passes its shop's path), but aria-current="page" must
 * only mark a link to the page itself. Tolerates a trailing slash.
 * @param {string} href
 * @param {string} pathname
 * @returns {boolean}
 */
export function isCurrentPage(href, pathname) {
  const strip = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  return strip(href) === strip(pathname);
}
