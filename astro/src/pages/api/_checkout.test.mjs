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
    vi.unstubAllEnvs();
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

  // The function refuses a one-of-a-kind piece another checkout is holding
  // with 409, and replaceToken is how a shopper's own earlier checkout is
  // replaced; both must pass through unchanged.
  it('forwards replaceToken and passes a 409 hold refusal back to the shopper', async () => {
    const message =
      "Someone is checking out Blue Bowl right now. If they don't finish, it'll be available again in about half an hour.";
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: message, code: 'RESERVED' }), { status: 409 }));
    const body = { items: [{ sku: 'bowl', qty: 1 }], replaceToken: 'a'.repeat(64) };

    const response = await POST({ request: requestWith(body) });

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual(body);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: message, code: 'RESERVED' });
  });

  it('returns 500 when the Cloud Function call itself fails (e.g. network error)', async () => {
    fetchSpy.mockRejectedValue(new Error('fetch failed'));

    const response = await POST({ request: requestWith(validBody) });

    expect(response.status).toBe(500);
  });

  // import.meta.env.DEV is a build-time flag baked into the bundle -- it's
  // false in the production-mode SSR artifact regardless of where that
  // artifact actually runs. Running that same built artifact locally
  // against the Firebase emulator would otherwise take the production URL
  // branch and create a REAL production Stripe checkout session instead of
  // calling the local Functions emulator. FUNCTIONS_EMULATOR is set at
  // runtime by the emulator itself, so it must be checked even when DEV
  // reads false (same fix as astro/src/pages/api/newsletter.js).
  it('targets the local Functions emulator when FUNCTIONS_EMULATOR is set, even if DEV reads false', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://checkout.stripe.com/pay/cs_test_1' }), {
        status: 200,
      })
    );

    await POST({ request: requestWith(validBody) });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('127.0.0.1:5001');
  });
});
