import { describe, it, expect } from 'vitest';
import { canonicalUrl } from './canonical-url.js';

describe('canonicalUrl', () => {
  it('points each page at its own URL on the production domain', () => {
    expect(canonicalUrl('/')).toBe('https://myfriendroze.com/');
    expect(canonicalUrl('/shop/plants')).toBe('https://myfriendroze.com/shop/plants');
    expect(canonicalUrl('/products/shino-wins')).toBe('https://myfriendroze.com/products/shino-wins');
  });

  it('drops a trailing slash so /shop and /shop/ share one canonical', () => {
    expect(canonicalUrl('/shop/')).toBe('https://myfriendroze.com/shop');
  });
});
