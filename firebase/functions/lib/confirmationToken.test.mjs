import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import -- an ESM import and a CJS require()
// of the same file create two separate module instances/script executions
// under this suite's v8 coverage provider, and the merged report only
// credits one of them. newsletterSignup.js requires this module via CJS
// require() at module scope (not just from a v8-ignored wrapper, so it
// can't be deferred lazily either) -- matching that same loading mechanism
// here is what makes the two files' exercised coverage actually merge.
const require = createRequire(import.meta.url);
const {
  generateConfirmationToken,
  verifyConfirmationToken,
  isConfirmationTokenExpired,
} = require('./confirmationToken.js');

const SECRET = 'test-secret';
const BASE = { email: 'buyer@example.com', firstName: 'Roze', lastName: 'M', issuedAt: 1700000000000 };

describe('generateConfirmationToken', () => {
  it('is deterministic for the same input', () => {
    expect(generateConfirmationToken(BASE, SECRET)).toBe(generateConfirmationToken(BASE, SECRET));
  });

  it('differs for a different secret', () => {
    expect(generateConfirmationToken(BASE, 'secret-a')).not.toBe(generateConfirmationToken(BASE, 'secret-b'));
  });

  it('differs for a different email', () => {
    const a = generateConfirmationToken(BASE, SECRET);
    const b = generateConfirmationToken({ ...BASE, email: 'other@example.com' }, SECRET);
    expect(a).not.toBe(b);
  });

  it('differs for a different issuedAt', () => {
    const a = generateConfirmationToken(BASE, SECRET);
    const b = generateConfirmationToken({ ...BASE, issuedAt: BASE.issuedAt + 1 }, SECRET);
    expect(a).not.toBe(b);
  });

  it('treats missing firstName/lastName the same as empty strings, not the literal "undefined"', () => {
    const a = generateConfirmationToken({ email: 'buyer@example.com', issuedAt: 1 }, SECRET);
    const b = generateConfirmationToken({ email: 'buyer@example.com', firstName: '', lastName: '', issuedAt: 1 }, SECRET);
    expect(a).toBe(b);
  });

  // Regression guard: Copilot review on PR #45 -- a plain colon-delimited
  // concatenation is ambiguous when a field can itself contain a colon.
  // These two field partitions used to hash identically, meaning a
  // legitimately-issued token for one could be replayed against the
  // other's (different!) email/name split.
  it('does not collide when a colon in email shifts content into firstName, vs. a colon in lastName', () => {
    const a = generateConfirmationToken(
      { email: 'victim@example.com:foo', firstName: 'y', lastName: 'z', issuedAt: 1700000000000 },
      SECRET
    );
    const b = generateConfirmationToken(
      { email: 'victim@example.com', firstName: 'foo', lastName: 'y:z', issuedAt: 1700000000000 },
      SECRET
    );
    expect(a).not.toBe(b);
  });
});

describe('verifyConfirmationToken', () => {
  it('accepts a token generated with the same fields and secret', () => {
    const token = generateConfirmationToken(BASE, SECRET);
    expect(verifyConfirmationToken({ ...BASE, token }, SECRET)).toBe(true);
  });

  it('rejects a token generated with a different secret', () => {
    const token = generateConfirmationToken(BASE, 'wrong-secret');
    expect(verifyConfirmationToken({ ...BASE, token }, SECRET)).toBe(false);
  });

  it('rejects when any signed field is tampered with after signing', () => {
    const token = generateConfirmationToken(BASE, SECRET);
    expect(verifyConfirmationToken({ ...BASE, lastName: 'Someone Else', token }, SECRET)).toBe(false);
  });

  // Regression guard, same class of bug fixed in unsubscribeToken.js this
  // morning: a repeated query param parses as an array, not a string, and
  // Buffer.from throws on that unless guarded.
  it('returns false instead of throwing for a non-string token', () => {
    expect(() => verifyConfirmationToken({ ...BASE, token: ['a', 'b'] }, SECRET)).not.toThrow();
    expect(verifyConfirmationToken({ ...BASE, token: ['a', 'b'] }, SECRET)).toBe(false);
    expect(verifyConfirmationToken({ ...BASE, token: undefined }, SECRET)).toBe(false);
  });

  it('returns false for an empty token', () => {
    expect(verifyConfirmationToken({ ...BASE, token: '' }, SECRET)).toBe(false);
  });
});

describe('isConfirmationTokenExpired', () => {
  const ISSUED_AT = 1700000000000;
  const MAX_AGE_MS = 48 * 60 * 60 * 1000;

  it('is not expired well within the window', () => {
    expect(isConfirmationTokenExpired(ISSUED_AT, ISSUED_AT + 1000, MAX_AGE_MS)).toBe(false);
  });

  it('is not expired at exactly the boundary', () => {
    expect(isConfirmationTokenExpired(ISSUED_AT, ISSUED_AT + MAX_AGE_MS, MAX_AGE_MS)).toBe(false);
  });

  it('is expired just past the boundary', () => {
    expect(isConfirmationTokenExpired(ISSUED_AT, ISSUED_AT + MAX_AGE_MS + 1, MAX_AGE_MS)).toBe(true);
  });

  // Regression guard: issuedAt comes from a URL query param as a string
  // (or an array, if repeated). Number(garbage) is NaN, and `now - NaN`
  // is also NaN, which is never `> maxAgeMs` -- a naive implementation
  // would treat a malformed issuedAt as permanently valid instead of
  // rejecting it.
  it('treats a non-numeric issuedAt as expired, not as never-expiring', () => {
    expect(isConfirmationTokenExpired('not-a-number', ISSUED_AT, MAX_AGE_MS)).toBe(true);
    expect(isConfirmationTokenExpired(['a', 'b'], ISSUED_AT, MAX_AGE_MS)).toBe(true);
    expect(isConfirmationTokenExpired(undefined, ISSUED_AT, MAX_AGE_MS)).toBe(true);
  });
});
