import { describe, it, expect, vi } from 'vitest';
import { handleCreateCheckoutSession } from './createCheckoutSession.js';

function fakeDoc(exists, data) {
  return { exists, data: () => data };
}

function fakeDb(docsBySku) {
  return {
    collection: () => ({
      doc: (sku) => ({
        get: () => Promise.resolve(docsBySku[sku] || fakeDoc(false)),
      }),
    }),
  };
}

function fakeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

const SITE_ORIGIN = 'https://myfriendroze.com';

describe('handleCreateCheckoutSession', () => {
  it('creates a Stripe Checkout Session priced from Firestore and returns its url', async () => {
    const db = fakeDb({
      'sku-1': fakeDoc(true, { title: 'Blue Branches', price: 70, isActive: true }),
    });
    const sessionsCreate = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_123' });
    const stripeClient = { checkout: { sessions: { create: sessionsCreate } } };
    const req = {
      method: 'POST',
      body: {
        customer: { email: 'buyer@example.com', name: 'Buyer', phone: '555-1234' },
        items: [{ sku: 'sku-1', qty: 1 }],
        notes: 'gift wrap please',
      },
    };
    const res = fakeRes();

    await handleCreateCheckoutSession(req, res, { db, stripeClient, siteOrigin: SITE_ORIGIN });

    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        customer_email: 'buyer@example.com',
        automatic_payment_methods: { enabled: true },
        shipping_address_collection: { allowed_countries: ['US'] },
        success_url: `${SITE_ORIGIN}/order/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_ORIGIN}/order/cancelled`,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: { name: 'Blue Branches' },
              unit_amount: 7000,
            },
            quantity: 1,
          },
        ],
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://checkout.stripe.com/pay/cs_test_123' });
  });

  it('rejects non-POST requests', async () => {
    const res = fakeRes();
    await handleCreateCheckoutSession(
      { method: 'GET', body: {} },
      res,
      { db: fakeDb({}), stripeClient: {}, siteOrigin: SITE_ORIGIN }
    );
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 400 when customer email is missing', async () => {
    const res = fakeRes();
    const req = {
      method: 'POST',
      body: { customer: { name: 'Buyer' }, items: [{ sku: 'sku-1', qty: 1 }] },
    };
    await handleCreateCheckoutSession(req, res, { db: fakeDb({}), stripeClient: {}, siteOrigin: SITE_ORIGIN });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when items is missing or empty', async () => {
    const res = fakeRes();
    const req = {
      method: 'POST',
      body: { customer: { email: 'buyer@example.com', name: 'Buyer' }, items: [] },
    };
    await handleCreateCheckoutSession(req, res, { db: fakeDb({}), stripeClient: {}, siteOrigin: SITE_ORIGIN });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for an unknown sku instead of calling Stripe', async () => {
    const db = fakeDb({}); // no products at all
    const sessionsCreate = vi.fn();
    const stripeClient = { checkout: { sessions: { create: sessionsCreate } } };
    const req = {
      method: 'POST',
      body: {
        customer: { email: 'buyer@example.com', name: 'Buyer' },
        items: [{ sku: 'does-not-exist', qty: 1 }],
      },
    };
    const res = fakeRes();

    await handleCreateCheckoutSession(req, res, { db, stripeClient, siteOrigin: SITE_ORIGIN });

    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for an inactive product', async () => {
    const db = fakeDb({
      'sku-1': fakeDoc(true, { title: 'Discontinued', price: 70, isActive: false }),
    });
    const sessionsCreate = vi.fn();
    const stripeClient = { checkout: { sessions: { create: sessionsCreate } } };
    const req = {
      method: 'POST',
      body: {
        customer: { email: 'buyer@example.com', name: 'Buyer' },
        items: [{ sku: 'sku-1', qty: 1 }],
      },
    };
    const res = fakeRes();

    await handleCreateCheckoutSession(req, res, { db, stripeClient, siteOrigin: SITE_ORIGIN });

    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 500 when Stripe itself errors', async () => {
    const db = fakeDb({
      'sku-1': fakeDoc(true, { title: 'Blue Branches', price: 70, isActive: true }),
    });
    const sessionsCreate = vi.fn().mockRejectedValue(new Error('Stripe is down'));
    const stripeClient = { checkout: { sessions: { create: sessionsCreate } } };
    const req = {
      method: 'POST',
      body: {
        customer: { email: 'buyer@example.com', name: 'Buyer' },
        items: [{ sku: 'sku-1', qty: 1 }],
      },
    };
    const res = fakeRes();

    await handleCreateCheckoutSession(req, res, { db, stripeClient, siteOrigin: SITE_ORIGIN });

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('ignores a client-supplied price and prices from Firestore instead', async () => {
    const db = fakeDb({
      'sku-1': fakeDoc(true, { title: 'Blue Branches', price: 70, isActive: true }),
    });
    const sessionsCreate = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_456' });
    const stripeClient = { checkout: { sessions: { create: sessionsCreate } } };
    const req = {
      method: 'POST',
      body: {
        customer: { email: 'buyer@example.com', name: 'Buyer' },
        items: [{ sku: 'sku-1', qty: 1, price: 0.01 }],
      },
    };
    const res = fakeRes();

    await handleCreateCheckoutSession(req, res, { db, stripeClient, siteOrigin: SITE_ORIGIN });

    const callArgs = sessionsCreate.mock.calls[0][0];
    expect(callArgs.line_items[0].price_data.unit_amount).toBe(7000);
  });
});
