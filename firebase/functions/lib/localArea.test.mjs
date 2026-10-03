import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import — see pricing.test.mjs for why.
const require = createRequire(import.meta.url);
const { isLocalZip } = require('./localArea.js');

describe('isLocalZip', () => {
  it('accepts Los Angeles County ZIPs (prefixes 900–908 and 910–918)', () => {
    for (const zip of ['90001', '90065', '90899', '91001', '91367', '91899']) {
      expect(isLocalZip(zip)).toBe(true);
    }
  });

  it('accepts a ZIP+4 by its first five digits', () => {
    expect(isLocalZip('90065-1234')).toBe(true);
  });

  it('allows surrounding whitespace', () => {
    expect(isLocalZip(' 90065 ')).toBe(true);
  });

  it('rejects ZIPs outside those prefixes', () => {
    // 909 (Inland Empire), 919+ (San Diego), 935 (Lancaster/Palmdale, partly Kern County), New York.
    for (const zip of ['90901', '91901', '93534', '10001', '89999']) {
      expect(isLocalZip(zip)).toBe(false);
    }
  });

  it('rejects anything that is not a 5-digit ZIP', () => {
    for (const bad of ['9006', '900655', 'abcde', '', null, undefined, 90065, ['90065']]) {
      expect(isLocalZip(bad)).toBe(false);
    }
  });
});
