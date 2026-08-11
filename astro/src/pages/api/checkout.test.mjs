import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './checkout.js';

function requestWith(body) {
  return new Request('http://localhost/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  customer: { email: 'buyer@example.com', name: 'Buyer Name' },
  items: [{ sku: 'sku-1', qty: 1 }],
};

describe('POST /api/checkout', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards a valid request to createCheckoutSession and returns its url', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://checkout.stripe.com/pay/cs_test_1' }), {
        status: 200,
      })
    );

    const response = await POST({ request: requestWith(validBody) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ url: 'https://checkout.stripe.com/pay/cs_test_1' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain('createCheckoutSession');
    expect(JSON.parse(options.body)).toEqual(validBody);
  });

  it('returns 400 without calling the Cloud Function when the request is invalid', async () => {
    const response = await POST({ request: requestWith({ customer: null, items: [] }) });

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    const badRequest = new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });

    const response = await POST({ request: badRequest });

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('propagates a Cloud Function error response', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'No product found for sku: bad-sku' }), {
        status: 400,
      })
    );

    const response = await POST({
      request: requestWith({ ...validBody, items: [{ sku: 'bad-sku', qty: 1 }] }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('No product found for sku: bad-sku');
  });

  it('returns 500 when the Cloud Function call itself fails (e.g. network error)', async () => {
    fetchSpy.mockRejectedValue(new Error('fetch failed'));

    const response = await POST({ request: requestWith(validBody) });

    expect(response.status).toBe(500);
  });
});
