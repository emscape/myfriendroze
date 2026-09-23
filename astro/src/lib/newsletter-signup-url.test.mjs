import { describe, it, expect } from 'vitest';
import { buildNewsletterSignupUrl } from './newsletter-signup-url.js';

describe('buildNewsletterSignupUrl', () => {
  it('points at the local Functions emulator in development', () => {
    expect(
      buildNewsletterSignupUrl({
        isDevelopment: true,
        projectId: 'myfriendroze-platform',
        region: 'us-west1',
      })
    ).toBe('http://127.0.0.1:5001/myfriendroze-platform/us-west1/newsletterSignup');
  });

  it('points at the raw Cloud Functions URL in production', () => {
    expect(
      buildNewsletterSignupUrl({
        isDevelopment: false,
        projectId: 'myfriendroze-platform',
        region: 'us-west1',
      })
    ).toBe('https://us-west1-myfriendroze-platform.cloudfunctions.net/newsletterSignup');
  });
});
