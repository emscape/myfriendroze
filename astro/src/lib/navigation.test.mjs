import { describe, it, expect } from 'vitest';
import { isNavItemActive } from './navigation.js';

describe('isNavItemActive', () => {
  it('matches a plain link by exact path', () => {
    expect(isNavItemActive({ href: '/gallery' }, '/gallery')).toBe(true);
    expect(isNavItemActive({ href: '/gallery' }, '/events')).toBe(false);
  });

  it('does not treat "/" as a prefix of every page', () => {
    expect(isNavItemActive({ href: '/' }, '/shop')).toBe(false);
    expect(isNavItemActive({ href: '/' }, '/')).toBe(true);
  });

  it('marks a dropdown active when the current path is any of its children', () => {
    const shops = {
      label: 'shops',
      children: [{ href: '/shop' }, { href: '/shop/plants' }, { href: '/shop/other' }],
    };
    expect(isNavItemActive(shops, '/shop')).toBe(true);
    expect(isNavItemActive(shops, '/shop/plants')).toBe(true);
    expect(isNavItemActive(shops, '/gallery')).toBe(false);
  });
});
