import { describe, it, expect, vi } from 'vitest';
import { requestCheckout } from './checkout-client.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('requestCheckout', () => {
  it('posts only the items to /api/checkout and returns the Stripe url and session id', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { url: 'https://checkout.stripe.com/c/pay/cs_1', id: 'cs_1' }));

    const checkout = await requestCheckout([{ sku: 'bowl', qty: 1 }], fetchImpl);

    expect(checkout).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_1', sessionId: 'cs_1' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ sku: 'bowl', qty: 1 }] }),
    });
  });

  it("throws the server's error message when checkout can't start", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'Product is out of stock: bowl' }));

    await expect(requestCheckout([{ sku: 'bowl', qty: 1 }], fetchImpl)).rejects.toThrow(
      'Product is out of stock: bowl'
    );
  });

  it('throws a general message for a success response without a url, or an unreadable body', async () => {
    await expect(requestCheckout([{ sku: 'b', qty: 1 }], vi.fn().mockResolvedValue(jsonResponse(200, {})))).rejects.toThrow(
      /couldn't start checkout/i
    );
    const badJson = { ok: false, status: 502, json: async () => { throw new SyntaxError('bad'); } };
    await expect(requestCheckout([{ sku: 'b', qty: 1 }], vi.fn().mockResolvedValue(badJson))).rejects.toThrow(
      /couldn't start checkout/i
    );
  });

  it('throws a connection message when the request itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(requestCheckout([{ sku: 'b', qty: 1 }], fetchImpl)).rejects.toThrow(/connection/i);
  });
});
