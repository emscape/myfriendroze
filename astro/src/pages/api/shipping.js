// Shipping Calculator API endpoint
// Fetches live USPS Ground Advantage rates from Notice 123
// Falls back to static rates if fetching/parsing fails

import { fetchCurrentRates, getDynamicRate, getRateStatus } from '../../lib/usps-rate-fetcher.js';
import { getDeliveryDays } from '../../lib/usps-rates.js';
import { getZone, ORIGIN_ZIP } from '../../lib/usps-zones.js';

export const prerender = false;

export async function POST({ request }) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body', success: false }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { zipCode, weight } = body;
    const weightNum = parseFloat(weight);

    // Validate inputs
    if (!zipCode || !/^\d{5}$/.test(zipCode)) {
      return new Response(
        JSON.stringify({ error: 'Invalid zip code format', success: false }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!weight || weightNum <= 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid weight', success: false }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (weightNum > 70) {
      return new Response(
        JSON.stringify({ error: 'Weight exceeds 70 lb limit for Ground Advantage', success: false }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get zone based on destination zip
    const zone = getZone(zipCode);

    // Get current rates (fetched from USPS or cached, with fallback)
    const { effectiveDate, usingFallback } = await fetchCurrentRates();

    // Get rate from dynamic table
    const totalCost = await getDynamicRate(weightNum, zone);

    // Get base rate (1lb rate for the zone)
    const baseRate = await getDynamicRate(1, zone);
    const weightCharge = Math.max(0, totalCost - baseRate);

    // Get delivery estimate
    const deliveryDays = getDeliveryDays(zone);

    console.log(`Shipping estimate: ${ORIGIN_ZIP} -> ${zipCode}, ${weightNum}lbs, Zone ${zone}, $${totalCost}${usingFallback ? ' (fallback rates)' : ''}`);

    // Return shipping estimate
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          zipCode,
          originZip: ORIGIN_ZIP,
          weight: weightNum,
          zone,
          baseRate: parseFloat(baseRate.toFixed(2)),
          weightCharge: parseFloat(weightCharge.toFixed(2)),
          totalCost: parseFloat(totalCost.toFixed(2)),
          carrier: 'USPS Ground Advantage',
          estimatedDays: `${deliveryDays} business days`,
          service: 'Ground Advantage',
          ratesEffective: effectiveDate,
          usingFallbackRates: usingFallback,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Shipping calculation error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to calculate shipping', success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET endpoint for rate status (admin/debugging)
export async function GET() {
  const status = getRateStatus();
  return new Response(
    JSON.stringify({ success: true, status }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
