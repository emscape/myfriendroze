// The canonical (and og:url) URL for a page: its own path on the
// production domain, not the request's host, so localhost, preview and
// Hosting-default domains never become canonical. A trailing slash is
// dropped so /shop and /shop/ don't count as two pages; the query string
// is never included.

const SITE_ORIGIN = 'https://myfriendroze.com';

/**
 * @param {string} pathname
 * @returns {string}
 */
export function canonicalUrl(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return new URL(path, SITE_ORIGIN).href;
}
