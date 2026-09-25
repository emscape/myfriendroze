import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { POST, GET } from './shipping.js';
import { refreshRates } from '../../lib/usps-rate-fetcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same real captured Notice 123 fixture usps-rate-fetcher.test.mjs uses --
// see that file for provenance.
const REAL_TABLE_HTML = fs.readFileSync(
  path.join(__dirname, '../../lib/__fixtures__/notice123-ground-advantage-retail.html'),
  'utf8'
);

function requestWith(body) {
  return new Request('http://localhost/api/shipping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// usps-rate-fetcher.js caches its parsed rates at module scope with a 7-day
// TTL, so each test forces a fresh fetch attempt via refreshRates() (using
// its own fetch mock) before calling the route, instead of relying on
// cross-test cache state.
async function warmCacheWith(fetchImpl) {
  vi.stubGlobal('fetch', fetchImpl);
  await refreshRates();
}

describe('POST /api/shipping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 400 for an invalid zip code, without fetching rates', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await POST({ request: requestWith({ zipCode: '123', weight: '2' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid zip code format', success: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing or non-positive weight', async () => {
    const response = await POST({ request: requestWith({ zipCode: '10001', weight: '0' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid weight', success: false });
  });

  it('returns 400 for a weight over the 70 lb Ground Advantage limit', async () => {
    const response = await POST({ request: requestWith({ zipCode: '10001', weight: '71' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Weight exceeds 70 lb limit for Ground Advantage', success: false });
  });

  it('returns 400 for malformed JSON', async () => {
    const badRequest = new Request('http://localhost/api/shipping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });

    const response = await POST({ request: badRequest });

    expect(response.status).toBe(400);
  });

  it('returns a single total cost (no baseRate/weightCharge breakdown) on success', async () => {
    await warmCacheWith(vi.fn().mockResolvedValue(new Response(REAL_TABLE_HTML, { status: 200 })));

    const response = await POST({ request: requestWith({ zipCode: '10001', weight: '2.5' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({
      zipCode: '10001',
      originZip: '90065',
      weight: 2.5,
      zone: 8,
      totalCost: expect.any(Number),
      carrier: 'USPS Ground Advantage',
      estimatedDays: expect.any(String),
      service: 'Ground Advantage',
      ratesEffective: expect.any(String),
      usingFallbackRates: false,
    });
    expect(data.data).not.toHaveProperty('baseRate');
    expect(data.data).not.toHaveProperty('weightCharge');
  });

  it('falls back to static rates (and reports usingFallbackRates) when the live fetch fails', async () => {
    await warmCacheWith(vi.fn().mockRejectedValue(new Error('network down')));

    const response = await POST({ request: requestWith({ zipCode: '10001', weight: '2.5' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.usingFallbackRates).toBe(true);
    expect(data.data.totalCost).toBeGreaterThan(0);
  });
});

describe('GET /api/shipping', () => {
  it('returns the current rate status', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toHaveProperty('usingFallback');
  });
});
