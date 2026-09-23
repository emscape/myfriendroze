import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import — same reasoning as pricing.test.mjs:
// this module is also require()'d by newsletterSignup.js.
const require = createRequire(import.meta.url);
const { buildSignupRecord, buildWelcomeEmailHtml, buildExistingDocUpdate, validateNameLengths } =
  require('./newsletter-signup.js');

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

describe('buildWelcomeEmailHtml', () => {
  it('personalizes the greeting when a first name is given', () => {
    expect(buildWelcomeEmailHtml({ firstName: 'Roze' })).toContain('Hi Roze,');
  });

  it('falls back to a generic greeting when no first name is given', () => {
    const html = buildWelcomeEmailHtml({});
    expect(html).toContain('Hi there,');
    expect(html).not.toContain('Hi ,');
  });

  it('falls back to a generic greeting for a blank first name', () => {
    const html = buildWelcomeEmailHtml({ firstName: '   ' });
    expect(html).toContain('Hi there,');
  });

  // firstName is request-controlled (astro/src/pages/api/newsletter.js
  // passes it straight through from the request body) and gets
  // interpolated into an email Brevo actually sends -- unescaped, a
  // crafted name could inject arbitrary markup into an email delivered
  // under this site's trusted sender identity to whatever address the
  // same request specifies.
  it('HTML-escapes a firstName containing markup instead of injecting it into the email', () => {
    const html = buildWelcomeEmailHtml({ firstName: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('Hi &lt;img src=x onerror=alert(1)&gt;,');
  });

  it('escapes ampersands and quotes too', () => {
    const html = buildWelcomeEmailHtml({ firstName: `Rose & "Bud"` });
    expect(html).toContain('Hi Rose &amp; &quot;Bud&quot;,');
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
});
