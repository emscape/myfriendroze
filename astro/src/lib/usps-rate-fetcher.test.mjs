import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseRateTable, parseEffectiveDate } from './usps-rate-fetcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Captured 2026-09-25 from the real https://pe.usps.com/text/dmm300/Notice123.htm
// Ground Advantage-Retail table. USPS now wraps each price in
// <span data-toggle='popover'>...</span> instead of a bare <td>$X.XX</td> --
// regression fixture for that change, which silently broke parseRateTable
// (it was only matching 6 of ~75 rows, so the site always fell back to the
// static January 2026 rate table).
const REAL_TABLE_HTML = fs.readFileSync(
  path.join(__dirname, '__fixtures__/notice123-ground-advantage-retail.html'),
  'utf8'
);

describe('parseRateTable', () => {
  it('parses every weight row out of the real, current Notice 123 markup (span-wrapped prices)', () => {
    const rates = parseRateTable(REAL_TABLE_HTML);

    // Sub-pound brackets
    expect(rates['4oz']).toEqual([7.90, 8.05, 8.15, 8.30, 8.60, 8.75, 8.95, 9.45, 9.45]);
    expect(rates['8oz']).toEqual([7.90, 8.05, 8.15, 8.30, 8.60, 8.75, 8.95, 9.45, 9.45]);
    expect(rates['12oz']).toEqual([9.55, 9.95, 10.20, 10.60, 10.95, 11.35, 11.95, 12.90, 12.90]);

    // Whole-pound brackets, including the top of the table
    expect(rates[1]).toBeDefined();
    expect(rates[70]).toBeDefined();
    expect(rates[70][8]).toBe(196.80);

    // At least the 4 sub-pound rows + 70 whole-pound rows -- well above the
    // >=50 sanity floor that used to reject a broken partial parse.
    expect(Object.keys(rates).length).toBeGreaterThanOrEqual(70);
  });

  it('throws instead of silently returning a handful of rows if the table structure changes again', () => {
    // Findable as a candidate table (has a "4 oz ... $7.x" row and a
    // ">70< ... $5x.xx" row, satisfying the structural fallback search),
    // but neither row has the 9 zone-price columns rowPattern requires, so
    // zero rows actually parse -- reproducing "structure changed under us"
    // rather than "table not found at all".
    const brokenHtml = `<table>
      <tr><td>4 oz</td><td>$7.90</td></tr>
      <tr><td>>70<</td><td>$55.00</td></tr>
    </table>`;

    expect(() => parseRateTable(brokenHtml)).toThrow(/Only found \d+ rate rows/);
  });

  it('throws when no Ground Advantage Retail table can be found at all', () => {
    expect(() => parseRateTable('<html><body>nothing here</body></html>')).toThrow(
      'Could not find Ground Advantage Retail rate table in Notice 123'
    );
  });
});

describe('parseEffectiveDate', () => {
  it('extracts a "Prices effective" date', () => {
    expect(parseEffectiveDate('<p>Prices effective January 18, 2026</p>')).toBe('January 18, 2026');
  });

  it('returns null when no effective-date text is present', () => {
    expect(parseEffectiveDate('<p>no date here</p>')).toBeNull();
  });
});
