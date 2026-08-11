import { describe, it, expect, vi } from 'vitest';
import stripePkg from 'stripe';
import { handleStripeWebhook } from './stripeWebhook.js';

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

function fakeDb({ existingOrder } = {}) {
  const state = { existingOrder, written: null };
  return {
    state,
    collection: () => ({ doc: (id) => ({ id }) }),
    runTransaction: async (fn) => {
      const tx = {
        get: async () => ({
          exists: !!state.existingOrder,
          data: () => state.existingOrder,
        }),
        set: (ref, data) => {
          state.written = data;
        },
      };
      return fn(tx);
    },
  };
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
});
