import { describe, it, expect, vi } from 'vitest';
import { handleEstimateShipping } from './estimateShipping.js';

const ADMIN = { auth: { token: { email: 'myfriendroze@gmail.com' } } };
const BOX = { weightGrams: 1360, lengthIn: 12, widthIn: 10, heightIn: 8 };
const PRICES = { '90012': '5.98', '10001': '11.30', '96813': '15.75' };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Answers each Shippo shipment request with the Ground Advantage price for its ZIP.
function shippoFake(prices = PRICES) {
  return vi.fn(async (_url, init) => {
    const zip = JSON.parse(init.body).address_to.zip;
    return jsonResponse(201, {
      rates: [{ provider: 'USPS', servicelevel: { token: 'usps_ground_advantage' }, amount: prices[zip] }],
    });
  });
}

const logger = { warn: vi.fn(), error: vi.fn() };

function call(request, deps = {}) {
  return handleEstimateShipping(request, { apiKey: 'shippo_live_x', fetchImpl: shippoFake(), logger, ...deps });
}

describe('handleEstimateShipping', () => {
  it('quotes Los Angeles, New York and Alaska/Hawaii and suggests New York + $2, rounded up', async () => {
    expect(await call({ ...ADMIN, data: BOX })).toEqual({
      quotes: [
        { label: 'Los Angeles', zip: '90012', amount: 5.98 },
        { label: 'New York', zip: '10001', amount: 11.3 },
        { label: 'Alaska / Hawaii', zip: '96813', amount: 15.75 },
      ],
      suggestedShipping: 14,
      testMode: false,
    });
  });

  it('sends the Shippo key and the parcel to the shipments endpoint', async () => {
    const fetchImpl = shippoFake();
    await call({ ...ADMIN, data: BOX }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.goshippo.com/shipments/');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('ShippoToken shippo_live_x');
    expect(JSON.parse(init.body).parcels[0]).toMatchObject({ weight: '47.97', mass_unit: 'oz', length: '12' });
  });

  it('says when the quotes come from a Shippo test key', async () => {
    const result = await call({ ...ADMIN, data: BOX }, { apiKey: 'shippo_test_x' });
    expect(result.testMode).toBe(true);
  });

  it('refuses a caller who is not an admin, without calling Shippo', async () => {
    const fetchImpl = shippoFake();
    for (const request of [{ data: BOX }, { auth: { token: { email: 'someone@example.com' } }, data: BOX }]) {
      await expect(call(request, { fetchImpl })).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a bad parcel with the reason, without calling Shippo', async () => {
    const fetchImpl = shippoFake();
    await expect(call({ ...ADMIN, data: { ...BOX, heightIn: 0 } }, { fetchImpl })).rejects.toMatchObject({
      code: 'invalid-argument',
      message: expect.stringMatching(/heightIn/),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports Shippo being unreachable as unavailable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(call({ ...ADMIN, data: BOX }, { fetchImpl })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('reports a Shippo error response as unavailable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { detail: 'Invalid token' }));
    await expect(call({ ...ADMIN, data: BOX }, { fetchImpl })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('reports a success response with an unreadable body as unavailable', async () => {
    const badJson = { ok: true, status: 201, json: async () => { throw new SyntaxError('Unexpected token'); } };
    const fetchImpl = vi.fn().mockResolvedValue(badJson);
    await expect(call({ ...ADMIN, data: BOX }, { fetchImpl })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('reports a non-numeric Ground Advantage amount as unavailable, never a NaN suggestion', async () => {
    const fetchImpl = shippoFake({ '90012': '5.98', '10001': 'n/a', '96813': '15.75' });
    await expect(call({ ...ADMIN, data: BOX }, { fetchImpl })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('reports a success response with a null body as unavailable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, null));
    await expect(call({ ...ADMIN, data: BOX }, { fetchImpl })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('gives each Shippo request a timeout, so a hung request fails fast', async () => {
    const fetchImpl = shippoFake();
    await call({ ...ADMIN, data: BOX }, { fetchImpl });

    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('reports a timed-out Shippo request as unavailable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await expect(call({ ...ADMIN, data: BOX }, { fetchImpl })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('reports a missing Ground Advantage rate as unavailable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { rates: [] }));
    await expect(call({ ...ADMIN, data: BOX }, { fetchImpl })).rejects.toMatchObject({ code: 'unavailable' });
  });
});
