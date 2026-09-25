import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleNewsletterSignup } = require('./newsletterSignup.js');
const { generateConfirmationToken } = require('./lib/confirmationToken.js');

const SECRET = 'test-secret';
const NOW = 1700000000000;
const now = () => NOW;

function fakeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

function baseDeps(overrides = {}) {
  return {
    checkRateLimit: vi.fn().mockResolvedValue(true),
    sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    secret: SECRET,
    now,
    ...overrides,
  };
}

describe('handleNewsletterSignup', () => {
  it('returns 405 for a non-POST request', async () => {
    const res = fakeRes();

    await handleNewsletterSignup({ method: 'GET' }, res, baseDeps());

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 429 when rate limited', async () => {
    const res = fakeRes();

    await handleNewsletterSignup(
      { method: 'POST', body: { email: 'buyer@example.com' } },
      res,
      baseDeps({ checkRateLimit: vi.fn().mockResolvedValue(false) })
    );

    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('returns 400 when the request body is missing entirely, rather than throwing', async () => {
    const res = fakeRes();

    await handleNewsletterSignup({ method: 'POST' }, res, baseDeps());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for an invalid email', async () => {
    const res = fakeRes();

    await handleNewsletterSignup(
      { method: 'POST', body: { email: 'not-an-email' } },
      res,
      baseDeps()
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  // This handler is directly publicly callable (invoker: 'public'), not
  // only reachable through the astro proxy's own validation.
  it('rejects an array-valued email instead of letting it reach regex coercion', async () => {
    const res = fakeRes();

    await handleNewsletterSignup(
      { method: 'POST', body: { email: ['a@example.com'] } },
      res,
      baseDeps()
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  // Regression guard: Copilot review on PR #45 -- an array-valued name
  // used to pass validateNameLengths silently, then produce a
  // confirmation link that could never verify (see
  // lib/newsletter-signup.test.mjs's validateNameLengths tests for the
  // full mechanism).
  it('returns 400 for an array-valued firstName', async () => {
    const res = fakeRes();

    await handleNewsletterSignup(
      { method: 'POST', body: { email: 'buyer@example.com', firstName: ['Roze', 'Extra'] } },
      res,
      baseDeps()
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for a firstName over 50 characters', async () => {
    const res = fakeRes();

    await handleNewsletterSignup(
      { method: 'POST', body: { email: 'buyer@example.com', firstName: 'a'.repeat(51) } },
      res,
      baseDeps()
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('sends a confirmation email carrying a validly-signed token, and returns success', async () => {
    const sendConfirmationEmail = vi.fn().mockResolvedValue(undefined);
    const res = fakeRes();

    await handleNewsletterSignup(
      { method: 'POST', body: { email: 'buyer@example.com', firstName: 'Roze' } },
      res,
      baseDeps({ sendConfirmationEmail })
    );

    expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
    const call = sendConfirmationEmail.mock.calls[0][0];
    expect(call.email).toBe('buyer@example.com');
    expect(call.firstName).toBe('Roze');
    expect(call.confirmUrl).toContain('confirmNewsletterSignup');
    expect(call.confirmUrl).toContain(`issuedAt=${NOW}`);

    const expectedToken = generateConfirmationToken(
      { email: 'buyer@example.com', firstName: 'Roze', lastName: undefined, issuedAt: NOW },
      SECRET
    );
    expect(call.confirmUrl).toContain(`token=${expectedToken}`);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('does not touch Firestore at all -- no db dependency exists for this step', async () => {
    // Double opt-in: nothing is written until the confirmation link is
    // clicked (confirmNewsletterSignup.js). Asserted implicitly by every
    // test above succeeding with no `db` in the injected deps at all --
    // if this file ever grows a direct Firestore write again, it would
    // need a `db` dependency these tests don't provide.
    const res = fakeRes();

    await handleNewsletterSignup(
      { method: 'POST', body: { email: 'buyer@example.com' } },
      res,
      baseDeps()
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 500 if sending the confirmation email fails', async () => {
    const res = fakeRes();

    await handleNewsletterSignup(
      { method: 'POST', body: { email: 'buyer@example.com' } },
      res,
      baseDeps({ sendConfirmationEmail: vi.fn().mockRejectedValue(new Error('brevo down')) })
    );

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
