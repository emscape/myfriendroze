import { describe, it, expect, vi } from 'vitest';
import { requestCheckout, LAST_CHECKOUT_KEY } from './checkout-client.js';

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

  // The server holds one-of-a-kind pieces for an open checkout. Naming the
  // last checkout this browser started lets the shopper check out again
  // (after backing out of Stripe) instead of being blocked by their own hold.
  describe('remembering the last checkout', () => {
    function memoryStorage(initial = {}) {
      const values = new Map(Object.entries(initial));
      return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        values,
      };
    }

    it('sends the last checkout it started as replacesSessionId, then remembers the new one', async () => {
      const storage = memoryStorage({ [LAST_CHECKOUT_KEY]: 'cs_old' });
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { url: 'https://checkout.stripe.com/c/pay/cs_new', id: 'cs_new' }));

      await requestCheckout([{ sku: 'bowl', qty: 1 }], fetchImpl, storage);

      expect(fetchImpl.mock.calls[0][1].body).toBe(
        JSON.stringify({ items: [{ sku: 'bowl', qty: 1 }], replacesSessionId: 'cs_old' })
      );
      expect(storage.getItem(LAST_CHECKOUT_KEY)).toBe('cs_new');
    });

    it('sends only the items when no checkout was started before', async () => {
      const storage = memoryStorage();
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { url: 'https://checkout.stripe.com/c/pay/cs_1', id: 'cs_1' }));

      await requestCheckout([{ sku: 'bowl', qty: 1 }], fetchImpl, storage);

      expect(fetchImpl.mock.calls[0][1].body).toBe(JSON.stringify({ items: [{ sku: 'bowl', qty: 1 }] }));
      expect(storage.getItem(LAST_CHECKOUT_KEY)).toBe('cs_1');
    });

    it('keeps the remembered checkout when a new one is refused', async () => {
      const storage = memoryStorage({ [LAST_CHECKOUT_KEY]: 'cs_old' });
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: 'Someone is checking out Blue Bowl' }));

      await expect(requestCheckout([{ sku: 'bowl', qty: 1 }], fetchImpl, storage)).rejects.toThrow(
        'Someone is checking out Blue Bowl'
      );
      expect(storage.getItem(LAST_CHECKOUT_KEY)).toBe('cs_old');
    });

    it('still checks out when site storage is blocked', async () => {
      const blocked = {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
      };
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { url: 'https://checkout.stripe.com/c/pay/cs_1', id: 'cs_1' }));

      await expect(requestCheckout([{ sku: 'bowl', qty: 1 }], fetchImpl, blocked)).resolves.toEqual({
        url: 'https://checkout.stripe.com/c/pay/cs_1',
        sessionId: 'cs_1',
      });
      expect(fetchImpl.mock.calls[0][1].body).toBe(JSON.stringify({ items: [{ sku: 'bowl', qty: 1 }] }));
    });
  });
});
