import { describe, it, expect } from 'vitest';
import { buildCheckoutSessionUrl } from './checkout-session-url.js';

describe('buildCheckoutSessionUrl', () => {
  it('targets the local Functions emulator in development', () => {
    const url = buildCheckoutSessionUrl({
      isDevelopment: true,
      forwardedHost: null,
      host: 'localhost:4321',
      projectId: 'myfriendroze-platform',
      region: 'us-west1',
    });

    expect(url).toBe(
      'http://127.0.0.1:5001/myfriendroze-platform/us-west1/createCheckoutSession'
    );
  });

  it('targets a same-origin Hosting-rewritten path in production, not the raw Cloud '
    + 'Functions URL (which is not publicly invokable — see stripe-payment-integration '
    + 'memory / project_backlog)', () => {
    const url = buildCheckoutSessionUrl({
      isDevelopment: false,
      forwardedHost: 'myfriendroze-platform.web.app',
      host: 'ssrastro-abc123-uw.a.run.app',
      projectId: 'myfriendroze-platform',
      region: 'us-west1',
    });

    expect(url).toBe('https://myfriendroze-platform.web.app/create-checkout-session-fn');
  });

  it('derives the production URL from x-forwarded-host, not Host — Firebase Hosting\'s '
    + 'rewrite-to-function proxy sets Host to the function\'s own internal address and '
    + 'only carries the original public-facing domain in x-forwarded-host (confirmed via '
    + 'the Hosting emulator: Host was 127.0.0.1:<functions port>, x-forwarded-host was the '
    + 'actual 127.0.0.1:<hosting port> the client connected to). Using Host here would '
    + 'build a URL pointing back at ssrAstro\'s own address instead of the public domain, '
    + 'silently breaking checkout in production.', () => {
    const url = buildCheckoutSessionUrl({
      isDevelopment: false,
      forwardedHost: 'myfriendroze.com',
      host: 'ssrastro-abc123-uw.a.run.app',
      projectId: 'myfriendroze-platform',
      region: 'us-west1',
    });

    expect(url).toBe('https://myfriendroze.com/create-checkout-session-fn');
  });

  it('falls back to Host when x-forwarded-host is absent (e.g. the function invoked '
    + 'directly, bypassing the Hosting rewrite — better to build *some* URL than throw)', () => {
    const url = buildCheckoutSessionUrl({
      isDevelopment: false,
      forwardedHost: null,
      host: 'myfriendroze-platform.web.app',
      projectId: 'myfriendroze-platform',
      region: 'us-west1',
    });

    expect(url).toBe('https://myfriendroze-platform.web.app/create-checkout-session-fn');
  });
});
