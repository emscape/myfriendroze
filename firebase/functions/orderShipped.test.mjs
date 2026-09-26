import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleSendOrderShippedNotification, HttpsError } = require('./orderShipped.js');

const ADMIN_EMAIL = 'myfriendroze@gmail.com';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// Matches the real shape lib/orderFromSession.js's sessionToOrderData
// produces and stripeWebhook.js writes to Firestore, doc ID = Stripe
// Checkout Session ID -- not the {email, orderDetails.orderNumber} shape
// this file's query used to assume (see Copilot's PR #46 review finding).
function realOrder(overrides = {}) {
  return {
    status: 'paid',
    stripeSessionId: 'cs_test_abc123',
    stripePaymentIntentId: 'pi_test_xyz',
    customer: { email: 'customer@example.com', name: 'Jane Doe', phone: null },
    items: [{ name: 'Blue Branches', qty: 1, amountTotal: 70 }],
    total: 70,
    currency: 'usd',
    shippingAddress: {
      name: 'Jane Doe',
      line1: '123 Main St',
      line2: null,
      city: 'Springfield',
      state: 'CA',
      postalCode: '90210',
      country: 'US',
    },
    notes: null,
    ...overrides,
  };
}

function fakeDb({ order = realOrder() } = {}) {
  const update = vi.fn();
  const get = vi.fn().mockResolvedValue({
    exists: order !== null,
    data: () => order,
  });
  // doc() records the id it's called with, so a test can assert the lookup
  // actually targets the right order (Copilot's PR #46 review finding: the
  // original fake ignored its argument, so a wrong-ID bug couldn't fail it).
  const doc = vi.fn((id) => ({ id }));
  // Routes through runTransaction, mirroring stripeWebhook.test.mjs's
  // fakeDb -- the claim-and-write must happen atomically (tx.get + tx.update
  // in one transaction), not as two separate calls, so a real Firestore
  // transaction retry can't let two concurrent invocations both observe the
  // notification as unsent (found in PR #46 review). tx.update's ref
  // argument is dropped before recording, so existing `toHaveBeenCalledWith`
  // assertions on the write payload alone still read naturally.
  const runTransaction = vi.fn((fn) => fn({
    get,
    update: (ref, data) => update(data),
  }));
  return {
    update,
    get,
    doc,
    runTransaction,
    collection: (name) => {
      if (name !== 'orders') throw new Error(`Unexpected collection requested in test: ${name}`);
      return { doc };
    },
  };
}

// Unlike fakeDb above (which just runs the transaction callback once,
// unconditionally accepting whatever it writes), this models Firestore's
// actual optimistic-concurrency behavior: each attempt reads a snapshot of
// the shared document version, and a write only commits if nothing else
// committed since that snapshot was read -- otherwise the whole callback is
// re-run against a fresh read, exactly like a real contended transaction.
// Needed to prove the concurrency property itself (found in PR #46 review):
// a fake with no shared state or retry behavior can't fail even if the
// production code isn't actually relying on transactional atomicity.
function fakeConcurrentDb({ order = realOrder() } = {}) {
  let committed = order;
  let version = 0;
  const doc = vi.fn((id) => ({ id }));

  const runTransaction = vi.fn(async (fn) => {
    for (;;) {
      const readVersion = version;
      const snapshot = committed;
      let pendingUpdate = null;

      const tx = {
        get: async () => ({
          exists: snapshot !== null,
          data: () => snapshot,
        }),
        update: (ref, data) => {
          pendingUpdate = data;
        },
      };

      const result = await fn(tx);

      if (pendingUpdate) {
        if (version !== readVersion) {
          continue; // Lost the race -- retry with a fresh read.
        }
        committed = { ...snapshot, ...pendingUpdate };
        version += 1;
      }

      return result;
    }
  });

  return {
    doc,
    runTransaction,
    collection: (name) => {
      if (name !== 'orders') throw new Error(`Unexpected collection requested in test: ${name}`);
      return { doc };
    },
  };
}

const shippingDetails = { trackingNumber: 'TRACK123', carrier: 'USPS', trackingUrl: 'https://example.com/t', estimatedDelivery: '2026-10-01' };

const baseRequest = (overrides = {}) => ({
  auth: { token: { email: ADMIN_EMAIL } },
  data: { orderId: 'cs_test_abc123', shippingDetails },
  ...overrides,
});

const baseDeps = (overrides = {}) => ({
  db: fakeDb(),
  sendBrevoEmail: vi.fn().mockResolvedValue(undefined),
  apiKey: 'brevo-key',
  templates: { orderShipped: 'tmpl-shipped' },
  ordersSender: { email: 'orders@myfriendroze.com', name: 'myfriendroze Orders' },
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  logger: silentLogger(),
  ...overrides,
});

describe('handleSendOrderShippedNotification', () => {
  it('rejects unauthenticated requests', async () => {
    await expect(
      handleSendOrderShippedNotification({ auth: null, data: { orderId: 'cs_test_abc123', shippingDetails } }, baseDeps())
    ).rejects.toThrow(HttpsError);
  });

  it('rejects requests from a non-admin email', async () => {
    await expect(
      handleSendOrderShippedNotification(
        baseRequest({ auth: { token: { email: 'stranger@example.com' } } }),
        baseDeps()
      )
    ).rejects.toThrow(HttpsError);
  });

  it('rejects a request with no data payload at all, without throwing a raw TypeError', async () => {
    await expect(
      handleSendOrderShippedNotification(baseRequest({ data: undefined }), baseDeps())
    ).rejects.toThrow('Order ID and shipping details are required');
  });

  it('rejects a request missing an orderId', async () => {
    await expect(
      handleSendOrderShippedNotification(baseRequest({ data: { shippingDetails } }), baseDeps())
    ).rejects.toThrow('Order ID and shipping details are required');
  });

  it('rejects a request missing shippingDetails', async () => {
    await expect(
      handleSendOrderShippedNotification(baseRequest({ data: { orderId: 'cs_test_abc123' } }), baseDeps())
    ).rejects.toThrow('Order ID and shipping details are required');
  });

  it('rejects with not-found when no order exists for the given orderId', async () => {
    const deps = baseDeps({ db: fakeDb({ order: null }) });

    await expect(handleSendOrderShippedNotification(baseRequest(), deps)).rejects.toThrow('Order not found');
  });

  it('rejects with failed-precondition when the order has no customer email on file', async () => {
    const deps = baseDeps({ db: fakeDb({ order: realOrder({ customer: { email: null, name: 'Jane Doe' } }) }) });

    await expect(handleSendOrderShippedNotification(baseRequest(), deps)).rejects.toThrow(
      'Order has no customer email on file'
    );
  });

  it('updates the order (looked up by Firestore doc ID) to shipped and sends the notification email', async () => {
    const deps = baseDeps();

    const result = await handleSendOrderShippedNotification(baseRequest(), deps);

    expect(deps.db.doc).toHaveBeenCalledWith('cs_test_abc123');
    // The claim-and-write must go through a real Firestore transaction, not
    // a plain get()-then-update() pair, so the atomicity guarantee that
    // prevents two concurrent invocations from both sending is actually
    // backed by Firestore itself (found in PR #46 review).
    expect(deps.db.runTransaction).toHaveBeenCalledTimes(1);
    expect(deps.db.get).toHaveBeenCalledTimes(1);
    expect(deps.db.update).toHaveBeenCalledWith({
      status: 'shipped',
      shippingDetails,
      shippedAt: 'SERVER_TIMESTAMP',
      shippedNotificationSentAt: 'SERVER_TIMESTAMP',
    });
    expect(deps.sendBrevoEmail).toHaveBeenCalledTimes(1);
    const payload = deps.sendBrevoEmail.mock.calls[0][0];
    expect(payload.to).toEqual([{ email: 'customer@example.com' }]);
    expect(payload.templateId).toBe('tmpl-shipped');
    // Derived from the real order doc, not caller-supplied free text:
    // stripeSessionId doubles as the order number shown to the customer,
    // same convention orderDataToConfirmationEmailParams already uses.
    expect(payload.params.ORDER_NUMBER).toBe('cs_test_abc123');
    expect(payload.params.CUSTOMER_NAME).toBe('Jane Doe');
    expect(payload.params.SHIPPING_ADDRESS).toBe('123 Main St, Springfield, CA 90210, US');
    expect(payload.params.TRACKING_NUMBER).toBe('TRACK123');
    expect(result).toEqual({
      success: true,
      message: 'Shipping notification sent!',
      orderId: 'cs_test_abc123',
      trackingNumber: 'TRACK123',
    });
  });

  // Regression guard: formatAddressRaw must stay unescaped here, since
  // orderShippedEmailParams applies its own single escaping pass --
  // formatAddress (which escapes internally) would double-escape, e.g.
  // "&" -> "&amp;" -> "&amp;amp;" (found in PR #46 review).
  it('escapes the shipping address exactly once, even with HTML-significant characters', async () => {
    const deps = baseDeps({
      db: fakeDb({
        order: realOrder({
          shippingAddress: {
            name: 'Jane Doe',
            line1: 'Smith & Sons, 5 <Main> St',
            line2: null,
            city: 'Springfield',
            state: 'CA',
            postalCode: '90210',
            country: 'US',
          },
        }),
      }),
    });

    await handleSendOrderShippedNotification(baseRequest(), deps);

    const payload = deps.sendBrevoEmail.mock.calls[0][0];
    expect(payload.params.SHIPPING_ADDRESS).toBe(
      'Smith &amp; Sons, 5 &lt;Main&gt; St, Springfield, CA 90210, US'
    );
  });

  // Regression guard: the message used to unconditionally say "Shipping
  // notification sent!" even here, where no email was actually sent
  // (found in PR #46 review as a "misleading delivery success" report).
  it('skips sending email (but still updates the order) when Brevo is not configured, and says so', async () => {
    const deps = baseDeps({ apiKey: null });

    const result = await handleSendOrderShippedNotification(baseRequest(), deps);

    expect(deps.sendBrevoEmail).not.toHaveBeenCalled();
    // The claim (status/shippedAt/shippedNotificationSentAt) is written
    // atomically before the email is even attempted -- see the "wraps a
    // failed Brevo send" test below for why the marker is set unconditionally
    // here rather than only on a confirmed send.
    expect(deps.db.update).toHaveBeenCalledWith(expect.objectContaining({
      shippedNotificationSentAt: 'SERVER_TIMESTAMP',
    }));
    expect(result).toEqual({
      success: true,
      message: 'Order marked as shipped, but no notification email was sent (Brevo not configured).',
      orderId: 'cs_test_abc123',
      trackingNumber: 'TRACK123',
    });
  });

  // The order is claimed (marked shipped) atomically *before* the email is
  // sent -- trading away automatic retry-ability on a Brevo failure in
  // exchange for concurrency safety (found in PR #46 review, second round):
  // the alternative -- checking-then-sending-then-writing -- leaves a gap
  // where two concurrent invocations (e.g. an admin double-click) could both
  // observe the notification as unsent and both email the customer. This is
  // the same tradeoff stripeWebhook.js already accepts for the order-
  // confirmation email: mark handled first, no auto-retry if the send fails.
  it('still marks the order shipped even when the Brevo send fails, matching stripeWebhook.js\'s precedent', async () => {
    const deps = baseDeps({ sendBrevoEmail: vi.fn().mockRejectedValue(new Error('Brevo API request failed with status 400')) });

    await expect(handleSendOrderShippedNotification(baseRequest(), deps)).rejects.toThrow(
      'Failed to send shipping notification'
    );
    expect(deps.db.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'shipped',
      shippedNotificationSentAt: 'SERVER_TIMESTAMP',
    }));
  });

  // Regression guard: calling this callable twice for the same order (e.g.
  // a client retry after a timeout) used to send a second duplicate
  // shipping email every time (found in PR #46 review).
  it('is idempotent: skips the email and the update when the order was already notified', async () => {
    const deps = baseDeps({
      db: fakeDb({ order: realOrder({
        status: 'shipped',
        shippingDetails: { trackingNumber: 'ORIGINAL-TRACK' },
        shippedNotificationSentAt: 'already-sent-timestamp',
      }) }),
    });

    const result = await handleSendOrderShippedNotification(baseRequest(), deps);

    expect(deps.sendBrevoEmail).not.toHaveBeenCalled();
    expect(deps.db.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Order was already marked shipped; no duplicate notification sent.',
      orderId: 'cs_test_abc123',
      trackingNumber: 'ORIGINAL-TRACK',
    });
  });

  // Proves the concurrency property itself, not just that a retry after
  // completion is idempotent: two invocations start before either has
  // committed, sharing one fakeConcurrentDb (which models Firestore's real
  // optimistic-concurrency retry, unlike fakeDb's single unconditional
  // pass-through) and one sendBrevoEmail spy. Exactly one must win the
  // claim and send; the other must lose the race, retry, observe the
  // winner's committed marker, and return "already notified" without a
  // second send (found in PR #46 review).
  it('is safe under truly concurrent invocations, not just sequential retries', async () => {
    const db = fakeConcurrentDb();
    const sendBrevoEmail = vi.fn().mockResolvedValue(undefined);

    const [resultA, resultB] = await Promise.all([
      handleSendOrderShippedNotification(baseRequest(), baseDeps({ db, sendBrevoEmail })),
      handleSendOrderShippedNotification(baseRequest(), baseDeps({ db, sendBrevoEmail })),
    ]);

    expect(sendBrevoEmail).toHaveBeenCalledTimes(1);
    const messages = [resultA.message, resultB.message].sort();
    expect(messages).toEqual([
      'Order was already marked shipped; no duplicate notification sent.',
      'Shipping notification sent!',
    ]);
  });

  it('wraps an unexpected Firestore failure as a generic error', async () => {
    const db = {
      collection: () => ({ doc: () => ({}) }),
      runTransaction: () => Promise.reject(new Error('firestore down')),
    };
    const deps = baseDeps({ db });

    await expect(handleSendOrderShippedNotification(baseRequest(), deps)).rejects.toThrow(
      'Failed to send shipping notification'
    );
  });

  // Regression guard for the PII-logging finding (same class as
  // eventNotification.js's fix): a successful send used to log
  // `Successfully sent shipping notification to ${email}`.
  it('logs a successful send by order id, never by the customer\'s email address', async () => {
    const logger = silentLogger();
    const deps = baseDeps({ logger });

    await handleSendOrderShippedNotification(baseRequest(), deps);

    for (const call of logger.info.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('customer@example.com');
    }
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('cs_test_abc123'));
  });
});
