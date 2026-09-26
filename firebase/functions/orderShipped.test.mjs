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
  const update = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn().mockResolvedValue({
    exists: order !== null,
    data: () => order,
  });
  // doc() records the id it's called with, so a test can assert the lookup
  // actually targets the right order (Copilot's PR #46 review finding: the
  // original fake ignored its argument, so a wrong-ID bug couldn't fail it).
  const doc = vi.fn((id) => ({ get, update }));
  return {
    update,
    get,
    doc,
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
    expect(deps.db.get).toHaveBeenCalledTimes(1);
    expect(deps.db.update).toHaveBeenCalledWith({
      status: 'shipped',
      shippingDetails,
      shippedAt: 'SERVER_TIMESTAMP',
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

  it('skips sending email (but still updates the order) when Brevo is not configured', async () => {
    const deps = baseDeps({ apiKey: null });

    const result = await handleSendOrderShippedNotification(baseRequest(), deps);

    expect(deps.sendBrevoEmail).not.toHaveBeenCalled();
    expect(deps.db.update).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('wraps a failed Brevo send as a generic error', async () => {
    const deps = baseDeps({ sendBrevoEmail: vi.fn().mockRejectedValue(new Error('Brevo API request failed with status 400')) });

    await expect(handleSendOrderShippedNotification(baseRequest(), deps)).rejects.toThrow(
      'Failed to send shipping notification'
    );
  });

  it('wraps an unexpected Firestore failure as a generic error', async () => {
    const db = {
      collection: () => ({ doc: () => ({ get: () => Promise.reject(new Error('firestore down')) }) }),
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
