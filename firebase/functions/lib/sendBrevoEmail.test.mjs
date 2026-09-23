import { describe, it, expect, vi } from 'vitest';
import { sendBrevoEmail } from './sendBrevoEmail.js';

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

describe('sendBrevoEmail', () => {
  it('POSTs the given payload to Brevo', async () => {
    const fetchImpl = fakeFetchOk();
    const payload = { sender: { email: 'events@myfriendroze.com' }, to: [{ email: 'buyer@example.com' }] };

    await sendBrevoEmail({ apiKey: 'test-api-key', payload, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: { 'api-key': 'test-api-key', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    );
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = fakeFetchError(400, 'invalid template id');

    await expect(
      sendBrevoEmail({ apiKey: 'test-api-key', payload: {}, fetchImpl })
    ).rejects.toThrow(/400/);
  });

  // Regression guard: Brevo's error response body can echo back
  // caller-supplied data (e.g. an invalid recipient's own email address),
  // and this error's message is what failure-logging code logs -- the
  // thrown error must never carry that body forward.
  it('never includes the response body in the thrown error, even when it contains an email address', async () => {
    const fetchImpl = fakeFetchError(400, 'Invalid recipient: leak-target@example.com');

    let caught;
    try {
      await sendBrevoEmail({ apiKey: 'test-api-key', payload: {}, fetchImpl });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).not.toContain('leak-target@example.com');
  });
});
