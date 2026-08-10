// USPS Rate Fetcher
// Scrapes Notice 123 for current Ground Advantage rates
// Falls back to static rates if parsing fails

import { GROUND_ADVANTAGE_RATES as STATIC_RATES, RATES_EFFECTIVE_DATE } from './usps-rates.js';
import { sendParsingErrorNotification } from './email-notify.js';

const NOTICE_123_URL = 'https://pe.usps.com/text/dmm300/Notice123.htm';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 30000; // 30 seconds

// In-memory cache
let cachedRates = null;
let cacheTimestamp = null;
let lastError = null;
let usingFallback = false;

/**
 * Parse the Ground Advantage rate table from Notice 123 HTML
 * @param {string} html - The HTML content of Notice 123
 * @returns {Object} - Parsed rate table
 */
function parseRateTable(html) {
  const rates = {};

  // Find the Ground Advantage Retail section specifically
  // Look for the section header/anchor that identifies Ground Advantage rates
  // The anchor is typically "_c450" or similar, or text "Ground Advantage—Retail"

  // First, try to isolate the Ground Advantage Retail section
  const sectionPatterns = [
    /Ground\s+Advantage[^<]*Retail[\s\S]*?(<table[\s\S]*?<\/table>)/i,
    /_c450[\s\S]*?(<table[\s\S]*?<\/table>)/i,
    /USPS\s+Ground\s+Advantage[\s\S]*?(<table[\s\S]*?<\/table>)/i,
  ];

  let tableHtml = null;

  for (const pattern of sectionPatterns) {
    const match = html.match(pattern);
    if (match) {
      tableHtml = match[1];
      console.log('[USPS Rate Fetcher] Found Ground Advantage section');
      break;
    }
  }

  // If we couldn't isolate the section, try to find a table with the right structure
  // Ground Advantage retail table has: weight column + 9 zone columns, starting prices around $7-8
  if (!tableHtml) {
    console.log('[USPS Rate Fetcher] Could not isolate section, searching for table with correct structure...');

    // Find all tables and look for one with 4 oz row starting around $7
    const tableMatches = html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi);

    for (const tableMatch of tableMatches) {
      const table = tableMatch[0];

      // Check if this table has a "4 oz" row with prices around $7
      const fourOzPattern = /4\s*oz[\s\S]*?\$?(7\.\d{2})/i;
      const has4oz = fourOzPattern.test(table);

      // Check if it has 70 lb row with prices around $59-182
      const seventyLbPattern = />70<[\s\S]*?\$?(5\d\.\d{2})/i;
      const has70lb = seventyLbPattern.test(table);

      if (has4oz && has70lb) {
        tableHtml = table;
        console.log('[USPS Rate Fetcher] Found table with correct 4oz and 70lb structure');
        break;
      }
    }
  }

  if (!tableHtml) {
    throw new Error('Could not find Ground Advantage Retail rate table in Notice 123');
  }

  // Now parse the rows from the isolated table
  // Match rows with weight and 9 price columns
  const rowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*>\$?([\d.]+)<\/td>[\s\S]*?<td[^>]*>\$?([\d.]+)<\/td>[\s\S]*?<td[^>]*>\$?([\d.]+)<\/td>[\s\S]*?<td[^>]*>\$?([\d.]+)<\/td>[\s\S]*?<td[^>]*>\$?([\d.]+)<\/td>[\s\S]*?<td[^>]*>\$?([\d.]+)<\/td>[\s\S]*?<td[^>]*>\$?([\d.]+)<\/td>[\s\S]*?<td[^>]*>\$?([\d.]+)<\/td>[\s\S]*?<td[^>]*>\$?([\d.]+)<\/td>[\s\S]*?<\/tr>/gi;

  let match;
  let foundRows = 0;

  while ((match = rowPattern.exec(tableHtml)) !== null) {
    const weightText = match[1].trim();
    const prices = [
      parseFloat(match[2]),
      parseFloat(match[3]),
      parseFloat(match[4]),
      parseFloat(match[5]),
      parseFloat(match[6]),
      parseFloat(match[7]),
      parseFloat(match[8]),
      parseFloat(match[9]),
      parseFloat(match[10]),
    ];

    // Skip if any price is NaN or seems invalid
    if (prices.some(p => isNaN(p) || p <= 0 || p > 500)) {
      continue;
    }

    // Validate this looks like Ground Advantage pricing (not some other table)
    // Zone 1 prices should be roughly $7-60 range for Ground Advantage
    if (prices[0] < 5 || prices[0] > 100) {
      continue;
    }

    // Parse weight key
    let weightKey;
    const ozMatch = weightText.match(/(\d+)\s*oz/i);
    const lbMatch = weightText.match(/^(\d+)$/);

    if (ozMatch) {
      weightKey = `${ozMatch[1]}oz`;
    } else if (lbMatch) {
      weightKey = parseInt(lbMatch[1], 10);
    } else {
      continue; // Skip unrecognized weight format
    }

    rates[weightKey] = prices;
    foundRows++;
  }

  // Validate we got a reasonable number of rows (expect ~73 rows: 3 oz + 70 lbs)
  if (foundRows < 50) {
    throw new Error(`Only found ${foundRows} rate rows, expected at least 50. Table structure may have changed.`);
  }

  // Sanity check: verify 1lb zone 1 rate is in expected range ($8-10)
  if (rates[1] && (rates[1][0] < 7 || rates[1][0] > 15)) {
    throw new Error(`1lb Zone 1 rate (${rates[1][0]}) outside expected range. May have parsed wrong table.`);
  }

  return rates;
}

/**
 * Extract the effective date from Notice 123 HTML
 * @param {string} html - The HTML content
 * @returns {string|null} - Effective date string or null
 */
function parseEffectiveDate(html) {
  // Look for patterns like "Effective January 18, 2026" or "effective 01/18/2026"
  const patterns = [
    /effective\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    /effective\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /prices?\s+effective\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Fetch and parse current USPS rates from Notice 123
 * @returns {Promise<{rates: Object, effectiveDate: string, fromCache: boolean, usingFallback: boolean}>}
 */
export async function fetchCurrentRates() {
  // Check cache first
  if (cachedRates && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL_MS)) {
    return {
      rates: cachedRates.rates,
      effectiveDate: cachedRates.effectiveDate,
      fromCache: true,
      usingFallback,
    };
  }

  try {
    console.log('[USPS Rate Fetcher] Fetching Notice 123...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(NOTICE_123_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ShippingCalculator/1.0)',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Parse rates
    const rates = parseRateTable(html);
    const effectiveDate = parseEffectiveDate(html) || new Date().toISOString().split('T')[0];

    // Update cache
    cachedRates = { rates, effectiveDate };
    cacheTimestamp = Date.now();
    usingFallback = false;
    lastError = null;

    console.log(`[USPS Rate Fetcher] Successfully parsed ${Object.keys(rates).length} rate entries. Effective: ${effectiveDate}`);

    return {
      rates,
      effectiveDate,
      fromCache: false,
      usingFallback: false,
    };

  } catch (error) {
    console.error('[USPS Rate Fetcher] Error fetching/parsing rates:', error.message);

    // Send notification if this is a new error (not repeated)
    if (!lastError || lastError !== error.message) {
      lastError = error.message;
      sendParsingErrorNotification(error.message).catch(emailErr => {
        console.error('[USPS Rate Fetcher] Failed to send error notification:', emailErr.message);
      });
    }

    // Fall back to static rates
    usingFallback = true;

    return {
      rates: STATIC_RATES,
      effectiveDate: RATES_EFFECTIVE_DATE,
      fromCache: false,
      usingFallback: true,
    };
  }
}

/**
 * Get the rate for a specific weight and zone
 * @param {number} weightLbs - Weight in pounds
 * @param {number} zone - USPS zone (1-9)
 * @returns {Promise<number>} - Shipping rate in dollars
 */
export async function getDynamicRate(weightLbs, zone) {
  const { rates } = await fetchCurrentRates();

  // Get weight key
  let weightKey;
  if (weightLbs <= 0) {
    weightKey = '4oz';
  } else if (weightLbs <= 0.25) {
    weightKey = '4oz';
  } else if (weightLbs <= 0.5) {
    weightKey = '8oz';
  } else if (weightLbs <= 0.75) {
    weightKey = '12oz';
  } else {
    weightKey = Math.min(Math.ceil(weightLbs), 70);
  }

  const rateRow = rates[weightKey];
  if (!rateRow) {
    throw new Error(`No rates found for weight: ${weightLbs} lbs (key: ${weightKey})`);
  }

  // Zone is 1-indexed, array is 0-indexed
  const zoneIndex = Math.max(0, Math.min(8, zone - 1));
  return rateRow[zoneIndex];
}

/**
 * Get current rate status (for debugging/admin)
 */
export function getRateStatus() {
  return {
    cached: !!cachedRates,
    cacheAge: cacheTimestamp ? Math.round((Date.now() - cacheTimestamp) / 1000 / 60) + ' minutes' : null,
    usingFallback,
    lastError,
    effectiveDate: cachedRates?.effectiveDate || RATES_EFFECTIVE_DATE,
  };
}

/**
 * Force refresh rates (bypass cache)
 */
export async function refreshRates() {
  cachedRates = null;
  cacheTimestamp = null;
  return fetchCurrentRates();
}
