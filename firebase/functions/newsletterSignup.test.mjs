import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleNewsletterSignup } = require('./newsletterSignup.js');
const { generateConfirmationToken, verifyConfirmationToken } = require('./lib/confirmationToken.js');

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

  // Regression guard: Copilot review on PR #45 -- buildConfirmUrl trims
  // firstName/lastName before putting them in the emailed link, but the
  // token used to be signed from the untrimmed value. A normal submission
  // like "  Roze  " (easy to get from mobile keyboards/autofill) signed
  // one payload and emailed a link containing the trimmed name, so
  // confirmNewsletterSignup.js recomputed a different HMAC and always
  // returned 403 -- permanently unconfirmable. Fixed by normalizing once
  // and using that value for both signing and the URL.
  it('signs the token with the same (trimmed) name it puts in the emailed link', async () => {
    const sendConfirmationEmail = vi.fn().mockResolvedValue(undefined);
    const res = fakeRes();

    await handleNewsletterSignup(
      { method: 'POST', body: { email: 'buyer@example.com', firstName: '  Roze  ', lastName: '  Smith  ' } },
      res,
      baseDeps({ sendConfirmationEmail })
    );

    const call = sendConfirmationEmail.mock.calls[0][0];
    expect(call.firstName).toBe('Roze');

    const parsed = new URL(call.confirmUrl);
    const queryFirstName = parsed.searchParams.get('firstName');
    const queryLastName = parsed.searchParams.get('lastName');
    const queryToken = parsed.searchParams.get('token');
    expect(queryFirstName).toBe('Roze');
    expect(queryLastName).toBe('Smith');

    // The exact check confirmNewsletterSignup.js performs: re-verify using
    // precisely what's in the URL. This must pass.
    expect(
      verifyConfirmationToken(
        { email: 'buyer@example.com', firstName: queryFirstName, lastName: queryLastName, issuedAt: String(NOW), token: queryToken },
        SECRET
      )
    ).toBe(true);
  });

  it('does not write a subscriber record -- the testable core takes no db dependency at all', async () => {
    // Double opt-in: nothing creates a newsletter_signups doc until the
    // confirmation link is clicked (confirmNewsletterSignup.js, which DOES
    // take a `db` dependency). handleNewsletterSignup's dependency list has
    // no `db` parameter at all, so there is no code path here that could
    // reach that collection even by accident -- true by construction, not
    // just because this test's deps object happens to omit one.
    // checkRateLimit's real implementation (in the v8-ignored wrapper) does
    // write to the separate newsletter_signup_rate_limits collection --
    // unrelated to this invariant, and deliberately untested here as thin
    // infrastructure wiring, same as this file's other tests.
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
