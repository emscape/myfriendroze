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
    const sessionsCreate = vi.fn().mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.stripe.com/pay/cs_test_123' });
    const stripeClient = { checkout: { sessions: { create: sessionsCreate } } };
    // Items only: Stripe's hosted page collects the shopper's details.
    const req = { method: 'POST', body: { items: [{ sku: 'sku-1', qty: 1 }] } };
    const res = fakeRes();

    await handleCreateCheckoutSession(req, res, { db, stripeClient, siteOrigin: SITE_ORIGIN });

    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        shipping_address_collection: { allowed_countries: ['US'] },
        phone_number_collection: { enabled: true },
        custom_fields: [
          {
            key: 'notes',
            label: { type: 'custom', custom: 'Special requests' },
            type: 'text',
            optional: true,
            text: { maximum_length: 255 },
          },
        ],
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
    expect(res.json).toHaveBeenCalledWith({
      url: 'https://checkout.stripe.com/pay/cs_test_123',
      // The site's success page matches this against Stripe's session_id.
      id: 'cs_test_123',
    });

    // Regression guard: `automatic_payment_methods` is a Payment Intents API
    // param, not valid on Checkout Session creation — passing it made every
    // real checkout attempt fail with a live Stripe "parameter_unknown"
    // error (caught via a real end-to-end request against test-mode Stripe,
    // not by this mocked test — mocking sessionsCreate here means this
    // suite alone can never catch an invalid-parameter error like that
    // one; only a real Stripe call surfaces it). Checkout Sessions don't
    // need this param at all — they use whatever payment methods are
    // enabled in the Stripe Dashboard by default.
    expect(sessionsCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ automatic_payment_methods: expect.anything() })
    );
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

  // Customer details from an older client are neither required nor passed
  // on: Stripe collects them, and client-supplied values aren't trusted.
  it('ignores customer details and notes sent by the client', async () => {
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

    expect(res.status).toHaveBeenCalledWith(200);
    const params = sessionsCreate.mock.calls[0][0];
    expect(params).not.toHaveProperty('customer_email');
    expect(params).not.toHaveProperty('metadata');
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

  // Checked before any Firestore read, so an oversized or duplicated item
  // list can't fan out into one product read per entry.
  it('returns 400 for a duplicated sku without reading Firestore or calling Stripe', async () => {
    const productGet = vi.fn();
    const db = { collection: () => ({ doc: () => ({ get: productGet }) }) };
    const sessionsCreate = vi.fn();
    const stripeClient = { checkout: { sessions: { create: sessionsCreate } } };
    const req = {
      method: 'POST',
      body: {
        customer: { email: 'buyer@example.com', name: 'Buyer' },
        items: [
          { sku: 'sku-1', qty: 1 },
          { sku: 'sku-1', qty: 1 },
        ],
      },
    };
    const res = fakeRes();

    await handleCreateCheckoutSession(req, res, { db, stripeClient, siteOrigin: SITE_ORIGIN });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DUPLICATE_SKU' }));
    expect(productGet).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
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
