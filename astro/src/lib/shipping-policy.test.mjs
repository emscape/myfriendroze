import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  FREE_SHIPPING_THRESHOLD,
  FLAT_SHIPPING,
  shippingSummary,
} from './shipping-policy.js';

// The checkout's own copy of these amounts decides what shoppers are
// actually charged; the site's copy only describes it, so they must agree.
const require = createRequire(import.meta.url);
const server = require('../../../firebase/functions/lib/shippingOptions.js');

describe('shipping policy', () => {
  it('matches the amounts checkout charges', () => {
    expect(FREE_SHIPPING_THRESHOLD * 100).toBe(server.FREE_SHIPPING_THRESHOLD_CENTS);
    expect(FLAT_SHIPPING * 100).toBe(server.FLAT_SHIPPING_CENTS);
    // Local delivery is arranged by email, not sold at checkout.
    expect(server).not.toHaveProperty('LOCAL_DELIVERY_CENTS');
  });

  it('summarizes the options in one line', () => {
    expect(shippingSummary()).toBe(
      'Free shipping on orders of $50 or more, $10 under $50. Free local pickup in Los Angeles; contact us for local delivery options.'
    );
  });
});
