import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleResendOrderConfirmation, HttpsError } = require('./orderConfirmation.js');

function fakeDb({ order } = {}) {
  return {
    collection: () => ({
      doc: () => ({
        get: () => Promise.resolve({ exists: !!order, data: () => order }),
      }),
    }),
  };
}

const ADMIN_EMAIL = 'myfriendroze@gmail.com';

describe('handleResendOrderConfirmation', () => {
  it('resends the confirmation email for an existing paid order', async () => {
    const order = { status: 'paid', customer: { email: 'buyer@example.com' } };
    const db = fakeDb({ order });
    const sendConfirmationEmail = vi.fn().mockResolvedValue(undefined);
    const request = { auth: { token: { email: ADMIN_EMAIL } }, data: { orderId: 'cs_test_1' } };

    const result = await handleResendOrderConfirmation(request, { db, sendConfirmationEmail });

    expect(sendConfirmationEmail).toHaveBeenCalledWith(order);
    expect(result).toEqual({ success: true });
  });

  it('rejects unauthenticated requests', async () => {
    const request = { auth: null, data: { orderId: 'cs_test_1' } };

    await expect(
      handleResendOrderConfirmation(request, { db: fakeDb(), sendConfirmationEmail: vi.fn() })
    ).rejects.toThrow(HttpsError);
  });

  it('rejects requests from a non-admin email', async () => {
    const request = { auth: { token: { email: 'stranger@example.com' } }, data: { orderId: 'cs_test_1' } };

    await expect(
      handleResendOrderConfirmation(request, { db: fakeDb(), sendConfirmationEmail: vi.fn() })
    ).rejects.toThrow(HttpsError);
  });

  it('rejects a request missing orderId', async () => {
    const request = { auth: { token: { email: ADMIN_EMAIL } }, data: {} };

    await expect(
      handleResendOrderConfirmation(request, { db: fakeDb(), sendConfirmationEmail: vi.fn() })
    ).rejects.toThrow(HttpsError);
  });

  it('rejects when no order exists for the given id', async () => {
    const db = fakeDb({ order: null });
    const request = { auth: { token: { email: ADMIN_EMAIL } }, data: { orderId: 'does-not-exist' } };

    await expect(
      handleResendOrderConfirmation(request, { db, sendConfirmationEmail: vi.fn() })
    ).rejects.toThrow(HttpsError);
  });
});
