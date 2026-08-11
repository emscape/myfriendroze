import { describe, it, expect, vi } from 'vitest';
import { sendOrderConfirmationEmail } from './sendOrderConfirmationEmail.js';

function fakeFetchOk() {
  return vi.fn().mockResolvedValue({ ok: true });
}

function fakeFetchError(status = 400, body = 'bad request') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

describe('sendOrderConfirmationEmail', () => {
  it('POSTs the correct payload to Brevo', async () => {
    const fetchImpl = fakeFetchOk();

    await sendOrderConfirmationEmail({
      apiKey: 'test-api-key',
      sender: { email: 'orders@myfriendroze.com', name: 'MyFriendRoze Orders' },
      templateId: 42,
      email: 'buyer@example.com',
      params: { EMAIL: 'buyer@example.com', ORDER_NUMBER: 'cs_test_1' },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: { 'api-key': 'test-api-key', 'Content-Type': 'application/json' },
      })
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({
      sender: { email: 'orders@myfriendroze.com', name: 'MyFriendRoze Orders' },
      to: [{ email: 'buyer@example.com' }],
      templateId: 42,
      params: { EMAIL: 'buyer@example.com', ORDER_NUMBER: 'cs_test_1' },
    });
  });

  it('throws with the response body when Brevo returns a non-ok status', async () => {
    const fetchImpl = fakeFetchError(400, 'invalid template id');

    await expect(
      sendOrderConfirmationEmail({
        apiKey: 'test-api-key',
        sender: { email: 'orders@myfriendroze.com', name: 'MyFriendRoze Orders' },
        templateId: 42,
        email: 'buyer@example.com',
        params: {},
        fetchImpl,
      })
    ).rejects.toThrow(/400/);
  });
});
