import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleSendOrderShippedNotification, HttpsError } = require('./orderShipped.js');

const ADMIN_EMAIL = 'myfriendroze@gmail.com';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakeDb({ orderFound = true } = {}) {
  const update = vi.fn().mockResolvedValue(undefined);
  return {
    update,
    collection: (name) => {
      if (name !== 'orders') throw new Error(`Unexpected collection requested in test: ${name}`);
      return {
        where: () => ({
          where: () => ({
            get: () => Promise.resolve({
              empty: !orderFound,
              docs: orderFound ? [{ ref: { update } }] : [],
            }),
          }),
        }),
      };
    },
  };
}

const orderDetails = { orderNumber: 'ORD-100', customerName: 'Jane Doe', shippingAddress: '123 Main St' };
const shippingDetails = { trackingNumber: 'TRACK123', carrier: 'USPS', trackingUrl: 'https://example.com/t', estimatedDelivery: '2026-10-01' };

const baseRequest = (overrides = {}) => ({
  auth: { token: { email: ADMIN_EMAIL } },
  data: { email: 'customer@example.com', orderDetails, shippingDetails },
  ...overrides,
});

const baseDeps = (overrides = {}) => ({
  db: fakeDb(),
  sendBrevoEmail: vi.fn().mockResolvedValue(undefined),
  apiKey: 'brevo-key',
  templates: { orderShipped: 'tmpl-shipped' },
  ordersSender: { email: 'orders@myfriendroze.com', name: 'MyFriendRoze Orders' },
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  logger: silentLogger(),
  ...overrides,
});

describe('handleSendOrderShippedNotification', () => {
  it('rejects unauthenticated requests', async () => {
    await expect(
      handleSendOrderShippedNotification(
        { auth: null, data: { email: 'customer@example.com', orderDetails, shippingDetails } },
        baseDeps()
      )
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

  it('rejects a request missing an email', async () => {
    await expect(
      handleSendOrderShippedNotification(baseRequest({ data: { orderDetails, shippingDetails } }), baseDeps())
    ).rejects.toThrow('Email, order details, and shipping details are required');
  });

  it('rejects a request missing orderDetails', async () => {
    await expect(
      handleSendOrderShippedNotification(baseRequest({ data: { email: 'a@example.com', shippingDetails } }), baseDeps())
    ).rejects.toThrow('Email, order details, and shipping details are required');
  });

  it('rejects a request missing shippingDetails', async () => {
    await expect(
      handleSendOrderShippedNotification(baseRequest({ data: { email: 'a@example.com', orderDetails } }), baseDeps())
    ).rejects.toThrow('Email, order details, and shipping details are required');
  });

  it('rejects an invalid email address', async () => {
    await expect(
      handleSendOrderShippedNotification(
        baseRequest({ data: { email: 'not-an-email', orderDetails, shippingDetails } }),
        baseDeps()
      )
    ).rejects.toThrow('Valid email address required');
  });

  it('updates the matching order to shipped and sends the notification email', async () => {
    const deps = baseDeps();

    const result = await handleSendOrderShippedNotification(baseRequest(), deps);

    expect(deps.db.update).toHaveBeenCalledWith({
      status: 'shipped',
      shippingDetails,
      shippedAt: 'SERVER_TIMESTAMP',
    });
    expect(deps.sendBrevoEmail).toHaveBeenCalledTimes(1);
    const payload = deps.sendBrevoEmail.mock.calls[0][0];
    expect(payload.to).toEqual([{ email: 'customer@example.com' }]);
    expect(payload.templateId).toBe('tmpl-shipped');
    expect(payload.params.TRACKING_NUMBER).toBe('TRACK123');
    expect(result).toEqual({
      success: true,
      message: 'Shipping notification sent!',
      orderNumber: 'ORD-100',
      trackingNumber: 'TRACK123',
    });
  });

  it('still sends the email when no matching order is found in Firestore', async () => {
    const deps = baseDeps({ db: fakeDb({ orderFound: false }) });

    const result = await handleSendOrderShippedNotification(baseRequest(), deps);

    expect(deps.db.update).not.toHaveBeenCalled();
    expect(deps.sendBrevoEmail).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
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
      collection: () => ({ where: () => ({ where: () => ({ get: () => Promise.reject(new Error('firestore down')) }) }) }),
    };
    const deps = baseDeps({ db });

    await expect(handleSendOrderShippedNotification(baseRequest(), deps)).rejects.toThrow(
      'Failed to send shipping notification'
    );
  });

  // Regression guard for the PII-logging finding (same class as
  // eventNotification.js's fix): a successful send used to log
  // `Successfully sent shipping notification to ${email}`.
  it('logs a successful send by order number, never by the customer\'s email address', async () => {
    const logger = silentLogger();
    const deps = baseDeps({ logger });

    await handleSendOrderShippedNotification(baseRequest(), deps);

    for (const call of logger.info.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('customer@example.com');
    }
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('ORD-100'));
  });
});
