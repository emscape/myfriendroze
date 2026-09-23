import { describe, it, expect } from 'vitest';
import { validateNewsletterRequest } from './newsletter-validation.js';

describe('validateNewsletterRequest', () => {
  it('accepts a valid email', () => {
    expect(validateNewsletterRequest({ email: 'roze@example.com' })).toEqual({ valid: true });
  });

  it('rejects a missing email', () => {
    expect(validateNewsletterRequest({})).toEqual({
      valid: false,
      error: 'A valid email address is required',
    });
  });

  it('rejects a malformed email', () => {
    expect(validateNewsletterRequest({ email: 'not-an-email' })).toEqual({
      valid: false,
      error: 'A valid email address is required',
    });
  });

  it('rejects a missing body entirely', () => {
    expect(validateNewsletterRequest(undefined)).toEqual({
      valid: false,
      error: 'A valid email address is required',
    });
  });

  // RegExp.test() coerces its argument to a string, so a single-element
  // array like ['roze@example.com'] stringifies to exactly that email and
  // passes EMAIL_RE.test() unnoticed. The downstream proxy then forwards
  // it and newsletterSignup.js's buildSignupRecord calls .toLowerCase() on
  // the array itself (not the coerced string), which throws and surfaces
  // as a 500 instead of this validator correctly rejecting it as a 400.
  it.each([['roze@example.com'], 42, { toString: () => 'roze@example.com' }, true])(
    'rejects a non-string email that would otherwise pass EMAIL_RE via type coercion (%j)',
    (nonStringEmail) => {
      expect(validateNewsletterRequest({ email: nonStringEmail })).toEqual({
        valid: false,
        error: 'A valid email address is required',
      });
    }
  );
});
