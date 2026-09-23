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
});
