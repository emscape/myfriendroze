import { describe, it, expect, vi } from 'vitest';
import stripePkg from 'stripe';
import { handleStripeWebhook } from './stripeWebhook.js';
import { memoryFirestore } from './test-support/memoryFirestore.mjs';

const realWebhooks = stripePkg.webhooks;
const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests_only';

function signedRequest(eventBody) {
  const payload = JSON.stringify(eventBody);
  const header = realWebhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { rawBody: payload, headers: { 'stripe-signature': header } };
}

function checkoutCompletedEvent(sessionOverrides = {}) {
  return {
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_abc123',
        payment_intent: 'pi_test_xyz',
        payment_status: 'paid',
        customer_details: { email: 'buyer@example.com' },
        amount_total: 7000,
        currency: 'usd',
        metadata: { customerName: 'Buyer Name' },
        shipping_details: undefined,
        ...sessionOverrides,
      },
    },
  };
}

function fakeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

// In-memory Firestore; state.written records the order doc a transaction
// set, so tests can tell "no write" apart from "rewrote the same data".
function fakeDb({ existingOrder, docs = {} } = {}) {
  const db = memoryFirestore({
    ...(existingOrder ? { 'orders/cs_test_abc123': existingOrder } : {}),
    ...docs,
  });
  const state = { written: null };
  const runTransaction = db.runTransaction;
  db.runTransaction = (fn) =>
    runTransaction((tx) =>
      fn({
        ...tx,
        set: (ref, data) => {
          if (ref.path.startsWith('orders/')) state.written = data;
          return tx.set(ref, data);
        },
      })
    );
  db.state = state;
  return db;
}

function fakeStripeClient({ listLineItemsResult } = {}) {
  return {
    webhooks: realWebhooks,
    checkout: {
      sessions: {
        listLineItems: vi.fn().mockResolvedValue(
          listLineItemsResult || { data: [{ description: 'Blue Branches', quantity: 1, amount_total: 7000 }] }
        ),
      },
    },
  };
}

describe('handleStripeWebhook', () => {
  it('accepts a validly-signed checkout.session.completed event, writes the order, and emails the customer', async () => {
    const event = checkoutCompletedEvent();
    const req = signedRequest(event);
    const res = fakeRes();
    const db = fakeDb();
    const stripeClient = fakeStripeClient();
    const sendConfirmationEmail = vi.fn().mockResolvedValue(undefined);
    const serverTimestamp = () => 'SERVER_TIMESTAMP';

    await handleStripeWebhook(req, res, {
      stripeClient,
      webhookSecret: WEBHOOK_SECRET,
      db,
      sendConfirmationEmail,
      serverTimestamp,
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.state.written).toMatchObject({
      status: 'paid',
      stripeSessionId: 'cs_test_abc123',
    });
    expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it('looks up the chosen shipping option and records it on the order', async () => {
    const event = checkoutCompletedEvent({
      shipping_cost: { amount_total: 0, shipping_rate: 'shr_pickup' },
      collected_information: {
        shipping_details: { name: 'Buyer Name', address: { line1: '1 St', postal_code: '90065', country: 'US' } },
      },
    });
    const db = fakeDb();
    const stripeClient = fakeStripeClient();
    stripeClient.shippingRates = {
      retrieve: vi.fn().mockResolvedValue({
        id: 'shr_pickup',
        display_name: 'Local pickup — Los Angeles',
        metadata: { method: 'local_pickup' },
      }),
    };

    await handleStripeWebhook(signedRequest(event), fakeRes(), {
      stripeClient,
      webhookSecret: WEBHOOK_SECRET,
      db,
      sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    });

    expect(stripeClient.shippingRates.retrieve).toHaveBeenCalledWith('shr_pickup');
    expect(db.state.written.shipping).toEqual({
      method: 'local_pickup',
      label: 'Local pickup — Los Angeles',
      amount: 0,
      outsideLocalArea: false,
    });
    expect(db.state.written.shippingAddress.postalCode).toBe('90065');
  });

  it('still writes a local pickup order with an address outside Los Angeles, flagged for follow-up', async () => {
    const event = checkoutCompletedEvent({
      shipping_cost: { amount_total: 0, shipping_rate: 'shr_pickup' },
      collected_information: {
        shipping_details: { name: 'Buyer Name', address: { line1: '1 St', postal_code: '10001', country: 'US' } },
      },
    });
    const db = fakeDb();
    const stripeClient = fakeStripeClient();
    stripeClient.shippingRates = {
      retrieve: vi.fn().mockResolvedValue({ id: 'shr_pickup', display_name: 'Local pickup — Los Angeles', metadata: { method: 'local_pickup' } }),
    };
    const sendConfirmationEmail = vi.fn().mockResolvedValue(undefined);
    const res = fakeRes();

    await handleStripeWebhook(signedRequest(event), res, {
      stripeClient,
      webhookSecret: WEBHOOK_SECRET,
      db,
      sendConfirmationEmail,
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.state.written.shipping.outsideLocalArea).toBe(true);
    expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it('still writes the order, with the shipping amount, when the shipping rate lookup fails', async () => {
    const event = checkoutCompletedEvent({ shipping_cost: { amount_total: 1000, shipping_rate: 'shr_gone' } });
    const db = fakeDb();
    const stripeClient = fakeStripeClient();
    stripeClient.shippingRates = { retrieve: vi.fn().mockRejectedValue(new Error('No such shipping rate')) };
    const sendConfirmationEmail = vi.fn().mockResolvedValue(undefined);
    const res = fakeRes();

    await handleStripeWebhook(signedRequest(event), res, {
      stripeClient,
      webhookSecret: WEBHOOK_SECRET,
      db,
      sendConfirmationEmail,
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.state.written.shipping).toEqual({ method: null, label: null, amount: 10, outsideLocalArea: false });
    expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it('does not look up a shipping option when the checkout had none', async () => {
    const db = fakeDb();
    const stripeClient = fakeStripeClient();
    stripeClient.shippingRates = { retrieve: vi.fn() };

    await handleStripeWebhook(signedRequest(checkoutCompletedEvent()), fakeRes(), {
      stripeClient,
      webhookSecret: WEBHOOK_SECRET,
      db,
      sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    });

    expect(stripeClient.shippingRates.retrieve).not.toHaveBeenCalled();
    expect(db.state.written.shipping).toBeNull();
  });

  // Stripe's listLineItems returns 10 items per page unless asked for more,
  // so this fake mirrors that default rather than handing back everything.
  it('records every line item of an order with more than 10 items', async () => {
    const allLineItems = Array.from({ length: 12 }, (_, i) => ({
      description: `Piece ${i + 1}`,
      quantity: 1,
      amount_total: 1000,
    }));
    const listLineItems = vi.fn(async (_sessionId, params = {}) => {
      const limit = params.limit ?? 10;
      return { data: allLineItems.slice(0, limit), has_more: allLineItems.length > limit };
    });
    const stripeClient = { webhooks: realWebhooks, checkout: { sessions: { listLineItems } } };
    const db = fakeDb();

    await handleStripeWebhook(signedRequest(checkoutCompletedEvent()), fakeRes(), {
      stripeClient,
      webhookSecret: WEBHOOK_SECRET,
      db,
      sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    });

    expect(db.state.written.items).toHaveLength(12);
  });

  // The actual security guarantee this module exists to provide — a request
  // whose body doesn't match its signature must be rejected outright, with
  // no Firestore write and no email, regardless of how plausible it looks.
  it('rejects a tampered payload (signature no longer matches) with 400 and does nothing else', async () => {
    const event = checkoutCompletedEvent();
    const req = signedRequest(event);
    // Tamper with the body after signing — simulates a MITM or forged request.
    req.rawBody = req.rawBody.replace('"amount_total":7000', '"amount_total":1');

    const res = fakeRes();
    const db = fakeDb();
    const stripeClient = fakeStripeClient();
    const sendConfirmationEmail = vi.fn();

    await handleStripeWebhook(req, res, {
      stripeClient,
      webhookSecret: WEBHOOK_SECRET,
      db,
      sendConfirmationEmail,
      serverTimestamp: () => 'x',
    });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.state.written).toBeNull();
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('rejects a request signed with the wrong secret', async () => {
    const event = checkoutCompletedEvent();
    const payload = JSON.stringify(event);
    const wrongHeader = realWebhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_a_completely_different_secret',
    });
    const req = { rawBody: payload, headers: { 'stripe-signature': wrongHeader } };
    const res = fakeRes();

    await handleStripeWebhook(req, res, {
      stripeClient: fakeStripeClient(),
      webhookSecret: WEBHOOK_SECRET,
      db: fakeDb(),
      sendConfirmationEmail: vi.fn(),
      serverTimestamp: () => 'x',
    });

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('acknowledges but ignores event types other than checkout.session.completed', async () => {
    const event = { id: 'evt_2', type: 'payment_intent.created', data: { object: {} } };
    const req = signedRequest(event);
    const res = fakeRes();
    const db = fakeDb();
    const stripeClient = fakeStripeClient();
    const sendConfirmationEmail = vi.fn();

    await handleStripeWebhook(req, res, {
      stripeClient,
      webhookSecret: WEBHOOK_SECRET,
      db,
      sendConfirmationEmail,
      serverTimestamp: () => 'x',
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(stripeClient.checkout.sessions.listLineItems).not.toHaveBeenCalled();
    expect(db.state.written).toBeNull();
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
  });

  // Stripe can deliver the same event more than once — a duplicate delivery
  // must not create a second order doc or send a second confirmation email.
  it('is idempotent: skips the write and the email when the order is already marked paid', async () => {
    const event = checkoutCompletedEvent();
    const req = signedRequest(event);
    const res = fakeRes();
    const db = fakeDb({ existingOrder: { status: 'paid', stripeSessionId: 'cs_test_abc123' } });
    const stripeClient = fakeStripeClient();
    const sendConfirmationEmail = vi.fn();

    await handleStripeWebhook(req, res, {
      stripeClient,
      webhookSecret: WEBHOOK_SECRET,
      db,
      sendConfirmationEmail,
      serverTimestamp: () => 'x',
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.state.written).toBeNull(); // no second write
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
  });

  // Found in PR #46 review: orderShipped.js transitions an order's status
  // to 'shipped' after this webhook creates it as 'paid'. The old idempotency
  // check (status === 'paid') would treat a duplicate delivery arriving
  // *after* shipping as unhandled, tx.set()-ing the whole document back to
  // fresh orderData -- wiping shippingDetails/shippedAt and resetting status
  // to 'paid' -- and sending a second confirmation email. Any existing order
  // doc for this session ID, regardless of its current status, means this
  // checkout was already processed and must never be overwritten.
  it('does not resurrect an already-shipped order on a duplicate webhook delivery', async () => {
    const event = checkoutCompletedEvent();
    const req = signedRequest(event);
    const res = fakeRes();
    const db = fakeDb({
      existingOrder: {
        status: 'shipped',
        stripeSessionId: 'cs_test_abc123',
        shippingDetails: { trackingNumber: 'TRACK123' },
        shippedAt: 'already-shipped-timestamp',
      },
    });
    const stripeClient = fakeStripeClient();
    const sendConfirmationEmail = vi.fn();

    await handleStripeWebhook(req, res, {
      stripeClient,
      webhookSecret: WEBHOOK_SECRET,
      db,
      sendConfirmationEmail,
      serverTimestamp: () => 'x',
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.state.written).toBeNull(); // shipped order must not be overwritten
    expect(sendConfirmationEmail).not.toHaveBeenCalled();
  });

  describe('order numbers', () => {
    async function deliver(db, sessionId = 'cs_test_abc123') {
      const sendConfirmationEmail = vi.fn().mockResolvedValue(undefined);
      await handleStripeWebhook(signedRequest(checkoutCompletedEvent({ id: sessionId })), fakeRes(), {
        stripeClient: fakeStripeClient(),
        webhookSecret: WEBHOOK_SECRET,
        db,
        sendConfirmationEmail,
        serverTimestamp: () => 'SERVER_TIMESTAMP',
      });
      return sendConfirmationEmail;
    }

    it('gives the first order number 1001 and emails it', async () => {
      const db = fakeDb();

      const sendConfirmationEmail = await deliver(db);

      expect(db.dump('orders/cs_test_abc123').orderNumber).toBe(1001);
      expect(sendConfirmationEmail.mock.calls[0][0].orderNumber).toBe(1001);
    });

    it('numbers each new order one higher than the last', async () => {
      const db = fakeDb();

      await deliver(db, 'cs_test_first');
      await deliver(db, 'cs_test_second');

      expect(db.dump('orders/cs_test_first').orderNumber).toBe(1001);
      expect(db.dump('orders/cs_test_second').orderNumber).toBe(1002);
    });

    it('does not use up a number on a duplicate delivery', async () => {
      const db = fakeDb();

      await deliver(db, 'cs_test_first');
      await deliver(db, 'cs_test_first');
      await deliver(db, 'cs_test_second');

      expect(db.dump('orders/cs_test_second').orderNumber).toBe(1002);
    });
  });

  describe('stock counts', () => {
    const FERN = { title: 'Fern', price: 12, isActive: true, inStock: true, category: 'plant' };
    const fernLineItems = (quantity) => ({
      data: [
        { description: 'Fern', quantity, amount_total: 1200 * quantity, price: { product: { metadata: { sku: 'fern' } } } },
      ],
    });

    async function deliverPaid(db, stripeClient) {
      await handleStripeWebhook(signedRequest(checkoutCompletedEvent()), fakeRes(), {
        stripeClient,
        webhookSecret: WEBHOOK_SECRET,
        db,
        sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
        serverTimestamp: () => 'SERVER_TIMESTAMP',
      });
    }

    it("asks Stripe for each line item's product, where the sku is kept", async () => {
      const stripeClient = fakeStripeClient({ listLineItemsResult: fernLineItems(1) });

      await deliverPaid(fakeDb({ docs: { 'products/fern': { ...FERN, stockQuantity: 5 } } }), stripeClient);

      expect(stripeClient.checkout.sessions.listLineItems).toHaveBeenCalledWith('cs_test_abc123', {
        limit: 100,
        expand: ['data.price.product'],
      });
    });

    it('counts stock down when the order is written', async () => {
      const db = fakeDb({ docs: { 'products/fern': { ...FERN, stockQuantity: 5 } } });

      await deliverPaid(db, fakeStripeClient({ listLineItemsResult: fernLineItems(2) }));

      expect(db.state.written).not.toBeNull();
      expect(db.dump('products/fern')).toEqual({ ...FERN, stockQuantity: 3 });
    });

    it('does not count stock down again on a duplicate delivery', async () => {
      const db = fakeDb({
        existingOrder: { status: 'paid', stripeSessionId: 'cs_test_abc123' },
        docs: { 'products/fern': { ...FERN, stockQuantity: 5 } },
      });

      await deliverPaid(db, fakeStripeClient({ listLineItemsResult: fernLineItems(2) }));

      expect(db.dump('products/fern')).toEqual({ ...FERN, stockQuantity: 5 });
    });
  });

  describe('checkout holds on one-of-a-kind pieces', () => {
    const BOWL = { title: 'Blue Bowl', price: 40, isActive: true, category: 'pottery' };
    const VASE = { title: 'Tall Vase', price: 90, isActive: true, category: 'other' };

    const NOW = 1_800_000_000_000;
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

    async function deliver(event, db, sendConfirmationEmail = vi.fn().mockResolvedValue(undefined)) {
      const res = fakeRes();
      await handleStripeWebhook(signedRequest(event), res, {
        stripeClient: fakeStripeClient(),
        webhookSecret: WEBHOOK_SECRET,
        db,
        sendConfirmationEmail,
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        now: () => NOW,
      });
      return res;
    }

    function sessionEvent(type, sessionOverrides) {
      return { ...checkoutCompletedEvent(sessionOverrides), type };
    }

    // Delayed payment methods (bank debits) complete the checkout before
    // the money arrives; Stripe reports the outcome later with
    // checkout.session.async_payment_succeeded or ..._failed.
    describe('delayed payments', () => {
      it('holds the pieces while the payment is pending, without an order, email or sale', async () => {
        const db = fakeDb({
          docs: {
            'products/bowl': BOWL,
            'checkoutHolds/bowl': { sessionId: 'cs_test_abc123', heldUntil: 1 },
          },
        });
        const email = vi.fn();

        const res = await deliver(checkoutCompletedEvent({ payment_status: 'unpaid' }), db, email);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(db.state.written).toBeNull();
        expect(email).not.toHaveBeenCalled();
        expect(db.dump('products/bowl')).toEqual(BOWL);
        expect(db.dump('checkoutHolds/bowl')).toEqual({
          sessionId: 'cs_test_abc123',
          heldUntil: NOW + FOURTEEN_DAYS_MS,
          pendingPayment: true,
        });
      });

      it('writes the order, emails and marks pieces sold when the delayed payment succeeds', async () => {
        const db = fakeDb({
          docs: {
            'products/bowl': BOWL,
            'checkoutHolds/bowl': { sessionId: 'cs_test_abc123', heldUntil: NOW + FOURTEEN_DAYS_MS },
          },
        });
        const email = vi.fn().mockResolvedValue(undefined);

        await deliver(sessionEvent('checkout.session.async_payment_succeeded', { payment_status: 'paid' }), db, email);

        expect(db.state.written.status).toBe('paid');
        expect(email).toHaveBeenCalledTimes(1);
        expect(db.dump('products/bowl')).toEqual({ ...BOWL, inStock: false });
        expect(db.has('checkoutHolds/bowl')).toBe(false);
      });

      it('releases the pieces when the delayed payment fails', async () => {
        const db = fakeDb({
          docs: {
            'products/bowl': BOWL,
            'checkoutHolds/bowl': { sessionId: 'cs_test_abc123', heldUntil: NOW + FOURTEEN_DAYS_MS },
          },
        });
        const email = vi.fn();

        const res = await deliver(
          sessionEvent('checkout.session.async_payment_failed', { payment_status: 'unpaid' }),
          db,
          email
        );

        expect(res.status).toHaveBeenCalledWith(200);
        expect(db.has('checkoutHolds/bowl')).toBe(false);
        expect(db.dump('products/bowl')).toEqual(BOWL);
        expect(db.state.written).toBeNull();
        expect(email).not.toHaveBeenCalled();
      });
    });

    it("marks the paid checkout's pieces sold and releases its holds when the order is written", async () => {
      const db = fakeDb({
        docs: {
          'products/bowl': BOWL,
          'products/vase': VASE,
          'checkoutHolds/bowl': { sessionId: 'cs_test_abc123', heldUntil: 1 },
          'checkoutHolds/vase': { sessionId: 'cs_someone_else', heldUntil: 1 },
        },
      });

      const res = await deliver(checkoutCompletedEvent(), db);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(db.state.written.stripeSessionId).toBe('cs_test_abc123');
      expect(db.dump('products/bowl')).toEqual({ ...BOWL, inStock: false });
      expect(db.has('checkoutHolds/bowl')).toBe(false);
      expect(db.dump('products/vase')).toEqual(VASE);
      expect(db.dump('checkoutHolds/vase')).toEqual({ sessionId: 'cs_someone_else', heldUntil: 1 });
    });

    // Roze may have put a piece back on sale (e.g. after a refund) by the
    // time a duplicate delivery arrives; it must not be marked sold again.
    it('leaves products alone on a duplicate delivery', async () => {
      const db = fakeDb({
        existingOrder: { status: 'paid', stripeSessionId: 'cs_test_abc123' },
        docs: {
          'products/bowl': { ...BOWL, inStock: true },
          'checkoutHolds/bowl': { sessionId: 'cs_test_abc123', heldUntil: 1 },
        },
      });

      await deliver(checkoutCompletedEvent(), db);

      expect(db.dump('products/bowl')).toEqual({ ...BOWL, inStock: true });
    });

    it('releases the holds of an expired checkout without writing an order', async () => {
      const db = fakeDb({
        docs: {
          'products/bowl': BOWL,
          'checkoutHolds/bowl': { sessionId: 'cs_test_expired', heldUntil: 1 },
          'checkoutHolds/vase': { sessionId: 'cs_someone_else', heldUntil: 1 },
        },
      });
      const event = {
        id: 'evt_3',
        type: 'checkout.session.expired',
        data: { object: { id: 'cs_test_expired', status: 'expired' } },
      };

      const res = await deliver(event, db);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(db.has('checkoutHolds/bowl')).toBe(false);
      expect(db.dump('checkoutHolds/vase')).toEqual({ sessionId: 'cs_someone_else', heldUntil: 1 });
      expect(db.dump('products/bowl')).toEqual(BOWL);
      expect(db.state.written).toBeNull();
    });
  });
});
