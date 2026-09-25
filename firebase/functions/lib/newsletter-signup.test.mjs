import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import — same reasoning as pricing.test.mjs:
// this module is also require()'d by newsletterSignup.js.
const require = createRequire(import.meta.url);
const {
  buildSignupRecord,
  buildConfirmUrl,
  buildExistingDocUpdate,
  validateNameLengths,
  evaluateRateLimit,
} = require('./newsletter-signup.js');

describe('buildSignupRecord', () => {
  it('lowercases and trims the email', () => {
    expect(buildSignupRecord({ email: '  Roze@Example.com  ' })).toEqual({
      email: 'roze@example.com',
      preferences: { newsletter: true },
    });
  });

  it('includes firstName/lastName when given', () => {
    expect(
      buildSignupRecord({ email: 'roze@example.com', firstName: 'Roze', lastName: 'Smith' })
    ).toEqual({
      email: 'roze@example.com',
      firstName: 'Roze',
      lastName: 'Smith',
      preferences: { newsletter: true },
    });
  });

  it('omits firstName/lastName entirely when not given, rather than storing empty strings', () => {
    expect(buildSignupRecord({ email: 'roze@example.com' })).toEqual({
      email: 'roze@example.com',
      preferences: { newsletter: true },
    });
  });

  it('trims firstName/lastName and omits them when blank after trimming', () => {
    expect(
      buildSignupRecord({ email: 'roze@example.com', firstName: '  Roze  ', lastName: '   ' })
    ).toEqual({
      email: 'roze@example.com',
      firstName: 'Roze',
      preferences: { newsletter: true },
    });
  });

  // A new signup always opts in -- unsubscribe.js flips preferences.newsletter
  // to false later, and newsletterSignup.js checks this same field to tell
  // a genuine resubscribe apart from an already-active subscriber.
  it('always sets preferences.newsletter to true for a new signup', () => {
    expect(buildSignupRecord({ email: 'roze@example.com' }).preferences).toEqual({
      newsletter: true,
    });
  });
});

describe('buildConfirmUrl', () => {
  const BASE = { email: 'roze@example.com', issuedAt: 1700000000000, token: 'abc123' };

  it('includes email, issuedAt, and token as query params', () => {
    const url = buildConfirmUrl(BASE);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://us-west1-myfriendroze-platform.cloudfunctions.net/confirmNewsletterSignup'
    );
    expect(parsed.searchParams.get('email')).toBe('roze@example.com');
    expect(parsed.searchParams.get('issuedAt')).toBe('1700000000000');
    expect(parsed.searchParams.get('token')).toBe('abc123');
  });

  it('includes firstName/lastName when given', () => {
    const url = buildConfirmUrl({ ...BASE, firstName: 'Roze', lastName: 'Smith' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('firstName')).toBe('Roze');
    expect(parsed.searchParams.get('lastName')).toBe('Smith');
  });

  it('omits firstName/lastName entirely when not given or blank', () => {
    const url = buildConfirmUrl({ ...BASE, firstName: '   ', lastName: undefined });
    const parsed = new URL(url);
    expect(parsed.searchParams.has('firstName')).toBe(false);
    expect(parsed.searchParams.has('lastName')).toBe(false);
  });

  // URLSearchParams handles encoding -- verify a value needing real
  // encoding (a name with a space and an ampersand) round-trips correctly
  // rather than corrupting the query string.
  it('URL-encodes special characters in names', () => {
    const url = buildConfirmUrl({ ...BASE, firstName: 'Rose & Bud' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('firstName')).toBe('Rose & Bud');
  });
});

describe('buildExistingDocUpdate', () => {
  // unsubscribe.js's "all" type sets preferences to
  // { newsletter: false, events: false, orders: true } -- orders: true is
  // deliberately preserved there for legal/record-keeping reasons. A
  // resubscribe (or any other existing-doc touch) must only flip
  // `newsletter`, never replace the whole preferences map wholesale, or it
  // would silently re-enable event notifications and drop the preserved
  // orders preference.
  it('flips preferences.newsletter to true without touching other preference fields', () => {
    const existingData = {
      email: 'roze@example.com',
      preferences: { newsletter: false, events: false, orders: true },
    };

    const update = buildExistingDocUpdate(existingData, { email: 'roze@example.com' });

    expect(update.preferences).toEqual({ newsletter: true, events: false, orders: true });
  });

  it('still sets preferences.newsletter to true when the existing doc has no preferences at all', () => {
    const existingData = { email: 'roze@example.com' };

    const update = buildExistingDocUpdate(existingData, { email: 'roze@example.com' });

    expect(update.preferences).toEqual({ newsletter: true });
  });

  it('updates email/firstName/lastName from the current request, same as buildSignupRecord', () => {
    const existingData = { email: 'roze@example.com', preferences: { newsletter: false } };

    const update = buildExistingDocUpdate(existingData, {
      email: 'roze@example.com',
      firstName: 'Roze',
      lastName: 'Smith',
    });

    expect(update.email).toBe('roze@example.com');
    expect(update.firstName).toBe('Roze');
    expect(update.lastName).toBe('Smith');
  });
});

describe('validateNameLengths', () => {
  it('accepts names within the 50-character limit', () => {
    expect(validateNameLengths({ firstName: 'Roze', lastName: 'Smith' })).toEqual({ valid: true });
  });

  it('accepts missing names entirely', () => {
    expect(validateNameLengths({})).toEqual({ valid: true });
  });

  // This handler is directly publicly callable (invoker: 'public'), not
  // only reachable through the astro proxy -- a caller that bypasses the
  // proxy could otherwise submit an arbitrarily long name that gets
  // persisted to Firestore and interpolated into the Brevo email with no
  // boundary check. The removed subscribe.js/createSubscription capped
  // each name at 50 characters; this restores an equivalent limit here.
  it('rejects a firstName longer than 50 characters', () => {
    const result = validateNameLengths({ firstName: 'a'.repeat(51) });
    expect(result.valid).toBe(false);
  });

  it('rejects a lastName longer than 50 characters', () => {
    const result = validateNameLengths({ lastName: 'a'.repeat(51) });
    expect(result.valid).toBe(false);
  });

  it('accepts a name exactly at the 50-character boundary', () => {
    expect(validateNameLengths({ firstName: 'a'.repeat(50) })).toEqual({ valid: true });
  });

  // Regression guard: a non-string name (e.g. an array from a repeated
  // form field, ?firstName=a&firstName=b) used to pass this check
  // silently, then get coerced into the confirmation token's HMAC input
  // while buildConfirmUrl omitted it from the emailed link entirely --
  // the resulting link could never verify, permanently breaking that
  // signup's confirmation.
  it('rejects an array-valued firstName', () => {
    const result = validateNameLengths({ firstName: ['Roze', 'Extra'] });
    expect(result.valid).toBe(false);
  });

  it('rejects an array-valued lastName', () => {
    const result = validateNameLengths({ lastName: ['Smith', 'Extra'] });
    expect(result.valid).toBe(false);
  });

  it('rejects an object-valued name', () => {
    const result = validateNameLengths({ firstName: { toString: () => 'Roze' } });
    expect(result.valid).toBe(false);
  });
});

describe('evaluateRateLimit', () => {
  const config = { maxRequests: 10, windowMs: 10 * 60 * 1000 };

  it('allows the first request when no prior state exists', () => {
    const result = evaluateRateLimit(null, 1_000_000, config);
    expect(result.allowed).toBe(true);
    expect(result.newState).toEqual({ windowStart: 1_000_000, count: 1 });
  });

  it('allows and increments while under the limit within the same window', () => {
    const existing = { windowStart: 1_000_000, count: 5 };
    const result = evaluateRateLimit(existing, 1_000_500, config);
    expect(result.allowed).toBe(true);
    expect(result.newState).toEqual({ windowStart: 1_000_000, count: 6 });
  });

  it('denies once the limit is reached within the same window', () => {
    const existing = { windowStart: 1_000_000, count: 10 };
    const result = evaluateRateLimit(existing, 1_000_500, config);
    expect(result.allowed).toBe(false);
    // State is unchanged on denial -- a rejected request shouldn't extend
    // or reset the window for the next legitimate attempt.
    expect(result.newState).toEqual(existing);
  });

  it('resets the window (and allows) once windowMs has elapsed since windowStart', () => {
    const existing = { windowStart: 1_000_000, count: 10 };
    const now = 1_000_000 + config.windowMs + 1;
    const result = evaluateRateLimit(existing, now, config);
    expect(result.allowed).toBe(true);
    expect(result.newState).toEqual({ windowStart: now, count: 1 });
  });

  // Exact-boundary case: at precisely windowMs elapsed, a strict
  // greater-than comparison would still treat the window as active and
  // incorrectly deny a request that should see a fresh window.
  it('resets the window at exactly windowMs elapsed (inclusive boundary)', () => {
    const existing = { windowStart: 1_000_000, count: 10 };
    const now = 1_000_000 + config.windowMs;
    const result = evaluateRateLimit(existing, now, config);
    expect(result.allowed).toBe(true);
    expect(result.newState).toEqual({ windowStart: now, count: 1 });
  });
});
