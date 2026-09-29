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

  it('never lets a path starting with // change the origin', () => {
    expect(canonicalUrl('//evil.example/shop')).toBe('https://myfriendroze.com/evil.example/shop');
    expect(canonicalUrl('///evil.example')).toBe('https://myfriendroze.com/evil.example');
    // URL parsing treats "\" as "/" for https, so "/\evil" is also "//evil".
    expect(canonicalUrl('/\\evil.example')).toBe('https://myfriendroze.com/evil.example');
  });
});
