import { describe, it, expect } from 'vitest';
import { generateUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribeToken.js';

describe('generateUnsubscribeToken', () => {
  it('produces a deterministic HMAC-SHA256 hex digest keyed on email, type, and secret', () => {
    const token = generateUnsubscribeToken('buyer@example.com', 'newsletter', 'test-secret');

    expect(token).toBe(generateUnsubscribeToken('buyer@example.com', 'newsletter', 'test-secret'));
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different token for a different secret', () => {
    const a = generateUnsubscribeToken('buyer@example.com', 'newsletter', 'secret-a');
    const b = generateUnsubscribeToken('buyer@example.com', 'newsletter', 'secret-b');

    expect(a).not.toBe(b);
  });

  it('produces a different token for a different type', () => {
    const a = generateUnsubscribeToken('buyer@example.com', 'newsletter', 'test-secret');
    const b = generateUnsubscribeToken('buyer@example.com', 'events', 'test-secret');

    expect(a).not.toBe(b);
  });
});

describe('verifyUnsubscribeToken', () => {
  it('accepts a token generated with the same email/type/secret', () => {
    const token = generateUnsubscribeToken('buyer@example.com', 'newsletter', 'test-secret');

    expect(verifyUnsubscribeToken('buyer@example.com', 'newsletter', token, 'test-secret')).toBe(true);
  });

  it('rejects a token generated with a different secret', () => {
    const token = generateUnsubscribeToken('buyer@example.com', 'newsletter', 'wrong-secret');

    expect(verifyUnsubscribeToken('buyer@example.com', 'newsletter', token, 'test-secret')).toBe(false);
  });

  it('rejects a token for a different email', () => {
    const token = generateUnsubscribeToken('buyer@example.com', 'newsletter', 'test-secret');

    expect(verifyUnsubscribeToken('someone-else@example.com', 'newsletter', token, 'test-secret')).toBe(false);
  });

  // Regression guard: crypto.timingSafeEqual throws on a buffer-length
  // mismatch -- a malformed/short token used to crash the unsubscribe
  // handler as an unhandled 500 instead of returning the intended 403.
  it('returns false instead of throwing when the token is shorter than expected', () => {
    expect(() =>
      verifyUnsubscribeToken('buyer@example.com', 'newsletter', 'short', 'test-secret')
    ).not.toThrow();
    expect(verifyUnsubscribeToken('buyer@example.com', 'newsletter', 'short', 'test-secret')).toBe(false);
  });

  it('returns false for an empty token', () => {
    expect(verifyUnsubscribeToken('buyer@example.com', 'newsletter', '', 'test-secret')).toBe(false);
  });
});
