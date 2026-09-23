// POST-level integration test for the newsletter proxy, mirroring
// _checkout.test.mjs's pattern -- exercises the actual wiring (fetch
// target/body, upstream status/body forwarding, malformed JSON, network
// failure) rather than just the extracted validator/URL-builder in
// isolation, so the original wrong-function regression (calling
// createSubscription, which was never deployed) can't silently return.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './newsletter.js';

function requestWith(body) {
  return new Request('http://localhost/api/newsletter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = { email: 'roze@example.com', firstName: 'Roze' };

describe('POST /api/newsletter', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards a valid request to newsletterSignup and returns its response', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ success: true, message: 'Signed up successfully!' }), {
        status: 200,
      })
    );

    const response = await POST({ request: requestWith(validBody) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, message: 'Signed up successfully!' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain('newsletterSignup');
    expect(JSON.parse(options.body)).toEqual(validBody);
  });

  it('returns 400 without calling the Cloud Function when the email is invalid', async () => {
    const response = await POST({ request: requestWith({ email: 'not-an-email' }) });

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    const badRequest = new Request('http://localhost/api/newsletter', {
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
      new Response(JSON.stringify({ error: 'Valid email address required.' }), { status: 400 })
    );

    const response = await POST({ request: requestWith(validBody) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Valid email address required.');
  });

  it('returns 500 when the Cloud Function call itself fails (e.g. network error)', async () => {
    fetchSpy.mockRejectedValue(new Error('fetch failed'));

    const response = await POST({ request: requestWith(validBody) });

    expect(response.status).toBe(500);
  });
});
