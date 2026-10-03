import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { isLocalZip, localZipHint } from './local-area.js';

// Checkout decides from the server's copy of this rule; the cart's copy only
// tells the shopper what to expect, so the two must agree.
const require = createRequire(import.meta.url);
const server = require('../../../firebase/functions/lib/localArea.js');

describe('isLocalZip', () => {
  it('agrees with checkout for every ZIP prefix', () => {
    for (let prefix = 0; prefix < 1000; prefix++) {
      const zip = `${String(prefix).padStart(3, '0')}01`;
      expect(isLocalZip(zip), zip).toBe(server.isLocalZip(zip));
    }
  });

  it('agrees with checkout on malformed input', () => {
    for (const value of ['', '9006', '900655', '90065-1234', ' 90065 ', 'abcde', null, undefined, 90065]) {
      expect(isLocalZip(value), String(value)).toBe(server.isLocalZip(value));
    }
  });
});

describe('localZipHint', () => {
  it('says nothing until a full ZIP is entered', () => {
    expect(localZipHint('')).toBe('');
    expect(localZipHint('900')).toBe('');
  });

  it('confirms pickup for a Los Angeles ZIP', () => {
    expect(localZipHint('90065')).toBe('Free local pickup will be offered at checkout.');
  });

  it('explains that pickup is Los Angeles only for any other ZIP', () => {
    expect(localZipHint('10001')).toBe(
      'Local pickup is only for Los Angeles County ZIP codes. Shipping is available anywhere in the US.'
    );
  });
});
