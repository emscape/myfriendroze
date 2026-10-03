import { describe, it, expect, vi } from 'vitest';
import { handleCreateCheckoutSession } from './createCheckoutSession.js';
import { createHash } from 'node:crypto';
import { memoryFirestore } from './test-support/memoryFirestore.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

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
      // Proof that a later checkout from this browser may replace this one.
      replaceToken: expect.stringMatching(/^[0-9a-f]{64}$/),
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

  describe('shipping options', () => {
    async function shippingMethodsFor(products, items, extraBody = {}) {
      const db = fakeDb(Object.fromEntries(Object.entries(products).map(([sku, p]) => [sku, fakeDoc(true, p)])));
      const sessionsCreate = vi.fn().mockResolvedValue({ id: 'cs_x', url: 'https://checkout.stripe.com/pay/cs_x' });
      await handleCreateCheckoutSession({ method: 'POST', body: { items, ...extraBody } }, fakeRes(), {
        db,
        stripeClient: { checkout: { sessions: { create: sessionsCreate } } },
        siteOrigin: SITE_ORIGIN,
      });
      return sessionsCreate.mock.calls[0][0].shipping_options.map((o) => [
        o.shipping_rate_data.metadata.method,
        o.shipping_rate_data.fixed_amount.amount,
      ]);
    }

    const FERN = { title: 'Fern', price: 12, isActive: true, category: 'plant' };

    it('offers $10 shipping and free pickup on an order under $50 for a Los Angeles ZIP', async () => {
      expect(await shippingMethodsFor({ fern: FERN }, [{ sku: 'fern', qty: 2 }], { localZip: '90065' })).toEqual([
        ['shipping', 1000],
        ['local_pickup', 0],
      ]);
    });

    it('offers only shipping when no ZIP is sent', async () => {
      expect(await shippingMethodsFor({ fern: FERN }, [{ sku: 'fern', qty: 2 }])).toEqual([['shipping', 1000]]);
    });

    it('offers only shipping for a ZIP outside Los Angeles', async () => {
      expect(await shippingMethodsFor({ fern: FERN }, [{ sku: 'fern', qty: 2 }], { localZip: '10001' })).toEqual([
        ['shipping', 1000],
      ]);
    });

    it('ignores a malformed ZIP rather than rejecting the checkout', async () => {
      expect(
        await shippingMethodsFor({ fern: FERN }, [{ sku: 'fern', qty: 2 }], { localZip: { zip: '90065' } })
      ).toEqual([['shipping', 1000]]);
    });

    it('ships free once quantity brings the Firestore-priced subtotal to $50', async () => {
      const methods = await shippingMethodsFor({ fern: FERN }, [{ sku: 'fern', qty: 5 }]);
      expect(methods[0]).toEqual(['free_shipping', 0]);
    });

    it('ignores a client-supplied price when deciding on free shipping', async () => {
      const methods = await shippingMethodsFor({ fern: FERN }, [{ sku: 'fern', qty: 1, price: 999 }]);
      expect(methods[0]).toEqual(['shipping', 1000]);
    });
  });

  describe('holding one-of-a-kind pieces', () => {
    const NOW = 1_800_000_000_000;
    const EXPIRES_AT = Math.floor(NOW / 1000) + 31 * 60;
    const HELD_UNTIL = EXPIRES_AT * 1000 + 5 * 60 * 1000;
    const NEW_TOKEN = 'a'.repeat(64);
    const MY_TOKEN = 'b'.repeat(64);
    const NEW_HOLD = { sessionId: 'cs_new', heldUntil: HELD_UNTIL, tokenHash: sha256(NEW_TOKEN) };
    const myHold = (extra = {}) => ({ sessionId: 'cs_mine', heldUntil: NOW + 60_000, tokenHash: sha256(MY_TOKEN), ...extra });
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
        newToken: () => NEW_TOKEN,
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
      expect(db.dump('checkoutHolds/bowl')).toEqual(NEW_HOLD);
      expect(res.json).toHaveBeenCalledWith({
        url: 'https://checkout.stripe.com/c/pay/cs_new',
        id: 'cs_new',
        replaceToken: NEW_TOKEN,
      });
    });

    // Stripe measures the 30-minute minimum from when it receives the
    // create call, so the expiry is computed just before it, after any
    // hold reads and Stripe calls that took time.
    it('computes the expiry from the time just before creating the Stripe session', async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) }, { 'checkoutHolds/bowl': myHold() });
      const stripeClient = stripeFake({ previous: { id: 'cs_mine', status: 'open' } });
      const LATER = NOW + 90_000;
      const times = [NOW, LATER];
      const res = fakeRes();

      await handleCreateCheckoutSession(
        { method: 'POST', body: { items: [{ sku: 'bowl', qty: 1 }], replaceToken: MY_TOKEN } },
        res,
        { db, stripeClient, siteOrigin: SITE_ORIGIN, now: () => times.shift() ?? LATER, newToken: () => NEW_TOKEN }
      );

      const expiresAt = Math.floor(LATER / 1000) + 31 * 60;
      expect(res.status).toHaveBeenCalledWith(200);
      expect(stripeClient.checkout.sessions.create.mock.calls[0][0].expires_at).toBe(expiresAt);
      expect(db.dump('checkoutHolds/bowl')).toEqual({
        sessionId: 'cs_new',
        heldUntil: expiresAt * 1000 + 5 * 60 * 1000,
        tokenHash: sha256(NEW_TOKEN),
      });
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
      expect(db.dump('checkoutHolds/bowl')).toEqual(NEW_HOLD);
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
      expect(db.dump('checkoutHolds/bowl')).toEqual(NEW_HOLD);
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

    it('refuses with 409 and says a payment is processing when the piece awaits a delayed payment', async () => {
      const db = fakeDb(
        { bowl: fakeDoc(true, BOWL) },
        { 'checkoutHolds/bowl': { sessionId: 'cs_other', heldUntil: NOW + 60_000, pendingPayment: true } }
      );

      const res = await checkout(db, stripeFake(), { items: [{ sku: 'bowl', qty: 1 }] });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: "A payment for Blue Bowl is being processed. If it doesn't go through, it'll be available again.",
        code: 'PAYMENT_PENDING',
      });
    });

    // A shopper who backs out of Stripe and checks out again must not be
    // blocked by their own first checkout, which is expired so only the new
    // one can be paid. The proof is the token this function returned with
    // that checkout, not its session id (which is in the checkout URL).
    it("replaces the shopper's own open checkout: expires it, then takes over its hold", async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) }, { 'checkoutHolds/bowl': myHold() });
      const stripeClient = stripeFake({ previous: { id: 'cs_mine', status: 'open' } });

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }], replaceToken: MY_TOKEN });

      expect(stripeClient.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_mine');
      expect(stripeClient.checkout.sessions.expire).toHaveBeenCalledWith('cs_mine');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(db.dump('checkoutHolds/bowl')).toEqual(NEW_HOLD);
    });

    it('does not expire the earlier checkout again if Stripe already expired it', async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) }, { 'checkoutHolds/bowl': myHold() });
      const stripeClient = stripeFake({ previous: { id: 'cs_mine', status: 'expired' } });

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }], replaceToken: MY_TOKEN });

      expect(stripeClient.checkout.sessions.expire).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // Paid, but the webhook that marks it sold hasn't landed yet.
    it('refuses when the earlier checkout was already paid', async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) }, { 'checkoutHolds/bowl': myHold() });
      const stripeClient = stripeFake({ previous: { id: 'cs_mine', status: 'complete', payment_status: 'paid' } });

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }], replaceToken: MY_TOKEN });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Blue Bowl has just sold.', code: 'OUT_OF_STOCK' });
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
      expect(stripeClient.checkout.sessions.expire).not.toHaveBeenCalled();
    });

    // Completed with a delayed payment method: the money hasn't arrived and
    // may not, so the piece isn't sold, but it can't be bought again yet.
    it("refuses with a payment-processing message when the earlier checkout's payment is still settling", async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) }, { 'checkoutHolds/bowl': myHold() });
      const stripeClient = stripeFake({ previous: { id: 'cs_mine', status: 'complete', payment_status: 'unpaid' } });

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }], replaceToken: MY_TOKEN });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: "A payment for Blue Bowl is being processed. If it doesn't go through, it'll be available again.",
        code: 'PAYMENT_PENDING',
      });
      expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
      // The webhook may not have arrived yet; the hold must already reflect
      // the pending payment so it neither lapses nor misleads other shoppers.
      expect(db.dump('checkoutHolds/bowl')).toEqual(
        myHold({ heldUntil: NOW + 14 * 24 * 60 * 60 * 1000, pendingPayment: true })
      );
    });

    // The session id appears in the Stripe checkout URL, so knowing it must
    // not let anyone expire that checkout or take its hold.
    it('does not let a session id alone replace a checkout', async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) }, { 'checkoutHolds/bowl': myHold() });
      const stripeClient = stripeFake({ previous: { id: 'cs_mine', status: 'open' } });

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }], replacesSessionId: 'cs_mine' });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(stripeClient.checkout.sessions.retrieve).not.toHaveBeenCalled();
      expect(stripeClient.checkout.sessions.expire).not.toHaveBeenCalled();
      expect(db.dump('checkoutHolds/bowl')).toEqual(myHold());
    });

    it("refuses another checkout's hold even when a valid token for a different checkout is sent", async () => {
      const db = fakeDb({ bowl: fakeDoc(true, BOWL) }, { 'checkoutHolds/bowl': myHold() });
      const stripeClient = stripeFake();

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }], replaceToken: 'c'.repeat(64) });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(stripeClient.checkout.sessions.retrieve).not.toHaveBeenCalled();
    });

    it('ignores a replaceToken that is not a token this function issues', async () => {
      const db = fakeDb(
        { bowl: fakeDoc(true, BOWL) },
        { 'checkoutHolds/bowl': myHold({ tokenHash: sha256('short') }) }
      );
      const stripeClient = stripeFake();

      const res = await checkout(db, stripeClient, { items: [{ sku: 'bowl', qty: 1 }], replaceToken: 'short' });

      expect(stripeClient.checkout.sessions.retrieve).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });
});
