import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import — same reasoning as pricing.test.mjs:
// this module is also require()'d by newsletterSignup.js.
const require = createRequire(import.meta.url);
const { buildSignupRecord, buildWelcomeEmailHtml } = require('./newsletter-signup.js');

describe('buildSignupRecord', () => {
  it('lowercases and trims the email', () => {
    expect(buildSignupRecord({ email: '  Roze@Example.com  ' })).toEqual({
      email: 'roze@example.com',
    });
  });

  it('includes firstName/lastName when given', () => {
    expect(
      buildSignupRecord({ email: 'roze@example.com', firstName: 'Roze', lastName: 'Smith' })
    ).toEqual({ email: 'roze@example.com', firstName: 'Roze', lastName: 'Smith' });
  });

  it('omits firstName/lastName entirely when not given, rather than storing empty strings', () => {
    expect(buildSignupRecord({ email: 'roze@example.com' })).toEqual({
      email: 'roze@example.com',
    });
  });

  it('trims firstName/lastName and omits them when blank after trimming', () => {
    expect(
      buildSignupRecord({ email: 'roze@example.com', firstName: '  Roze  ', lastName: '   ' })
    ).toEqual({ email: 'roze@example.com', firstName: 'Roze' });
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
});
