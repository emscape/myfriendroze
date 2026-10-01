import { describe, it, expect, vi } from 'vitest';
import { handleCreateCheckoutSession } from './createCheckoutSession.js';
import { memoryFirestore } from './test-support/memoryFirestore.mjs';

function fakeDoc(exists, data) {
  return { exists, data: () => data };
}

// Products keyed by sku, plus any other documents by full path (holds).
function fakeDb(docsBySku, otherDocs = {}) {
  const docs = { ...otherDocs };
  for (const [sku, doc] of Object.entries(docsBySku)) {
    if (doc.exists) docs[`products/${sku}`] = doc.data();
  }
  return memoryFirestore(docs);
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

  describe('holding one-of-a-kind pieces', () => {
    const NOW = 1_800_000_000_000;
    const EXPIRES_AT = Math.floor(NOW / 1000) + 31 * 60;
    const HELD_UNTIL = EXPIRES_AT * 1000 + 5 * 60 * 1000;
    const BOWL = { title: 'Blue Bowl', price: 40, isActive: true, category: 'pottery' };
    const FERN = { title: 'Fern', price: 12, isActive: true, category: 'plant' };

    function stripeFake({ created = { id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' }, previous } = {}) {
      return {
        checkout: {
          sessions: {
            create: vi.fn().mockResolvedValue(created),
            retrieve: vi.fn().mockResolvedValue(previous),
            expire: vi.fn().mockResolvedValue({}),
          },
        },
      };
    }

    async function checkout(db, stripeClient, body) {
      const res = fakeRes();
      await handleCreateCheckoutSession({ method: 'POST', body }, res, {
        db,
        stripeClient,
        siteOrigin: SITE_ORIGIN,
        now: () => NOW,
      });
      return res;
    }

    function stealHoldDuringCreate(db, stripeClient) {
      stripeClient.checkout.sessions.create.mockImplementation(async () => {
        await db.collection('checkoutHolds').doc('bowl').set({ sessionId: 'cs_rival', heldUntil: NOW + 60_000 });
        return { id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' };
      });
    }

    it('gives the Stripe checkout a 31-minute life and holds the piece until 5 minutes after', async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) });
      const stripeClient = stripeFake();

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }] });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(stripeClient.checkout.sessions.create.mock.calls[0][0].expires_at).toBe(EXPIRES_AT);
      expect(db.dump('checkoutHolds/bowl')).toEqual({ sessionId: 'cs_new', heldUntil: HELD_UNTIL });
    });

    it('does not hold plants', async () => {
      const db = fakeDb({ fern: fakeDoc(true, FERN), bowl: fakeDoc(true, BOWL) });

      const res = await checkout(db, stripeFake(), {
        items: [
          { sku: 'fern', qty: 3 },
          { sku: 'bowl', qty: 1 },
        ],
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(db.has('checkoutHolds/fern')).toBe(false);
      expect(db.dump('checkoutHolds/bowl')).toEqual({ sessionId: 'cs_new', heldUntil: HELD_UNTIL });
    });

    it('refuses with 409 and the reason while another checkout holds the piece, without calling Stripe', async () => {
      const db = fakeDb(
        { bowl: fakeDoc(true, BOWL) },
        { 'checkoutHolds/bowl': { sessionId: 'cs_other', heldUntil: NOW + 60_000 } }
      );
      const stripeClient = stripeFake();

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }] });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error:
          "Someone is checking out Blue Bowl right now. If they don't finish, it'll be available again in about half an hour.",
        code: 'RESERVED',
      });
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
      expect(db.dump('checkoutHolds/bowl')).toEqual({ sessionId: 'cs_other', heldUntil: NOW + 60_000 });
    });

    it('allows a piece whose hold has lapsed', async () => {
      const db = fakeDb(
        { bowl: fakeDoc(true, BOWL) },
        { 'checkoutHolds/bowl': { sessionId: 'cs_other', heldUntil: NOW - 1 } }
      );

      const res = await checkout(db, stripeFake(), { items: [{ sku: 'bowl', qty: 1 }] });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(db.dump('checkoutHolds/bowl')).toEqual({ sessionId: 'cs_new', heldUntil: HELD_UNTIL });
    });

    // Two shoppers can pass the first check at the same moment; the
    // transaction decides, and the loser's new Stripe session is expired so
    // its url (never returned) can't be paid either.
    it('expires its new Stripe session and returns 409 when another checkout wins the hold first', async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) });
      const stripeClient = stripeFake();
      stealHoldDuringCreate(db, stripeClient);

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }] });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'RESERVED' }));
      expect(stripeClient.checkout.sessions.expire).toHaveBeenCalledWith('cs_new');
      expect(db.dump('checkoutHolds/bowl')).toEqual({ sessionId: 'cs_rival', heldUntil: NOW + 60_000 });
    });

    it('still returns 409 when expiring the losing session fails', async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) });
      const stripeClient = stripeFake();
      stealHoldDuringCreate(db, stripeClient);
      stripeClient.checkout.sessions.expire.mockRejectedValue(new Error('Stripe is down'));

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }] });

      expect(res.status).toHaveBeenCalledWith(409);
    });

    // A shopper who backs out of Stripe and checks out again must not be
    // blocked by their own first checkout, which is expired so only the new
    // one can be paid.
    it("replaces the shopper's own open checkout: expires it, then takes over its hold", async () => {
      const db = fakeDb(
        { bowl: fakeDoc(true, BOWL) },
        { 'checkoutHolds/bowl': { sessionId: 'cs_mine', heldUntil: NOW + 60_000 } }
      );
      const stripeClient = stripeFake({ previous: { id: 'cs_mine', status: 'open' } });

      const res = await checkout(db, stripeClient, {
        items: [{ sku: 'bowl', qty: 1 }],
        replacesSessionId: 'cs_mine',
      });

      expect(stripeClient.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_mine');
      expect(stripeClient.checkout.sessions.expire).toHaveBeenCalledWith('cs_mine');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(db.dump('checkoutHolds/bowl')).toEqual({ sessionId: 'cs_new', heldUntil: HELD_UNTIL });
    });

    it('does not expire the earlier checkout again if Stripe already expired it', async () => {
      const db = fakeDb(
        { bowl: fakeDoc(true, BOWL) },
        { 'checkoutHolds/bowl': { sessionId: 'cs_mine', heldUntil: NOW + 60_000 } }
      );
      const stripeClient = stripeFake({ previous: { id: 'cs_mine', status: 'expired' } });

      const res = await checkout(db, stripeClient, {
        items: [{ sku: 'bowl', qty: 1 }],
        replacesSessionId: 'cs_mine',
      });

      expect(stripeClient.checkout.sessions.expire).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // Paid, but the webhook that marks it sold hasn't landed yet.
    it('refuses when the earlier checkout was already paid', async () => {
      const db = fakeDb(
        { bowl: fakeDoc(true, BOWL) },
        { 'checkoutHolds/bowl': { sessionId: 'cs_mine', heldUntil: NOW + 60_000 } }
      );
      const stripeClient = stripeFake({ previous: { id: 'cs_mine', status: 'complete' } });

      const res = await checkout(db, stripeClient, {
        items: [{ sku: 'bowl', qty: 1 }],
        replacesSessionId: 'cs_mine',
      });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Blue Bowl has just sold.', code: 'OUT_OF_STOCK' });
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
      expect(stripeClient.checkout.sessions.expire).not.toHaveBeenCalled();
    });

    // Only a hold the named session actually has triggers any Stripe call,
    // so a guessed or stale id does nothing.
    it('ignores replacesSessionId when that session holds none of the pieces', async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) });
      const stripeClient = stripeFake();

      const res = await checkout(db, stripeClient, {
        items: [{ sku: 'bowl', qty: 1 }],
        replacesSessionId: 'cs_someone_else',
      });

      expect(stripeClient.checkout.sessions.retrieve).not.toHaveBeenCalled();
      expect(stripeClient.checkout.sessions.expire).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('ignores a replacesSessionId that is not a Stripe checkout id', async () => {
      const db = fakeDb(
        { bowl: fakeDoc(true, BOWL) },
        { 'checkoutHolds/bowl': { sessionId: 'not-a-session', heldUntil: NOW + 60_000 } }
      );
      const stripeClient = stripeFake();

      const res = await checkout(db, stripeClient, {
        items: [{ sku: 'bowl', qty: 1 }],
        replacesSessionId: 'not-a-session',
      });

      expect(stripeClient.checkout.sessions.retrieve).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });
});
