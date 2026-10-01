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

  describe('checkout holds on one-of-a-kind pieces', () => {
    const BOWL = { title: 'Blue Bowl', price: 40, isActive: true, category: 'pottery' };
    const VASE = { title: 'Tall Vase', price: 90, isActive: true, category: 'other' };

    async function deliver(event, db) {
      const res = fakeRes();
      await handleStripeWebhook(signedRequest(event), res, {
        stripeClient: fakeStripeClient(),
        webhookSecret: WEBHOOK_SECRET,
        db,
        sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
        serverTimestamp: () => 'SERVER_TIMESTAMP',
      });
      return res;
    }

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
