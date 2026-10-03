import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import — see pricing.test.mjs for why.
const require = createRequire(import.meta.url);
const {
  subtotalCents,
  buildShippingOptions,
  FREE_SHIPPING_THRESHOLD_CENTS,
} = require('./shippingOptions.js');

function lineItem(unitAmount, quantity) {
  return {
    price_data: { currency: 'usd', product_data: { name: 'x' }, unit_amount: unitAmount },
    quantity,
  };
}

// method → amount in cents, for compact assertions.
function amountsByMethod(options) {
  return Object.fromEntries(
    options.map((o) => [o.shipping_rate_data.metadata.method, o.shipping_rate_data.fixed_amount.amount])
  );
}

describe('subtotalCents', () => {
  it('adds up unit amount times quantity across line items', () => {
    expect(subtotalCents([lineItem(1500, 2), lineItem(2250, 1)])).toBe(5250);
  });
});

describe('buildShippingOptions', () => {
  const LOCAL = { local: true };

  it('free shipping starts at $50.00', () => {
    expect(FREE_SHIPPING_THRESHOLD_CENTS).toBe(5000);
  });

  it('offers only the mail option to a shopper outside Los Angeles', () => {
    expect(amountsByMethod(buildShippingOptions(4999))).toEqual({ shipping: 1000 });
    expect(amountsByMethod(buildShippingOptions(5000, { local: false }))).toEqual({ free_shipping: 0 });
  });

  it('charges $10 shipping under $50, alongside free pickup in Los Angeles', () => {
    expect(amountsByMethod(buildShippingOptions(4999, LOCAL))).toEqual({
      shipping: 1000,
      local_pickup: 0,
    });
  });

  it('ships free at exactly $50', () => {
    expect(amountsByMethod(buildShippingOptions(5000, LOCAL))).toEqual({
      free_shipping: 0,
      local_pickup: 0,
    });
  });

  it('ships free over $50', () => {
    expect(amountsByMethod(buildShippingOptions(12000))).toHaveProperty('free_shipping', 0);
  });

  it('lists the mail option first, so Stripe preselects it', () => {
    expect(buildShippingOptions(1000)[0].shipping_rate_data.metadata.method).toBe('shipping');
    expect(buildShippingOptions(9000)[0].shipping_rate_data.metadata.method).toBe('free_shipping');
  });

  it('names pickup as Los Angeles and offers no local delivery', () => {
    const names = Object.fromEntries(
      buildShippingOptions(1000, LOCAL).map((o) => [o.shipping_rate_data.metadata.method, o.shipping_rate_data.display_name])
    );
    expect(names).not.toHaveProperty('local_delivery');
    expect(names.local_pickup).toBe('Local pickup — Los Angeles');
  });

  it('builds fixed-amount USD rates', () => {
    for (const option of buildShippingOptions(1000, LOCAL)) {
      expect(option.shipping_rate_data.type).toBe('fixed_amount');
      expect(option.shipping_rate_data.fixed_amount.currency).toBe('usd');
    }
  });

  it('rejects a subtotal that is not a non-negative integer number of cents', () => {
    for (const bad of [-1, 12.5, NaN, '5000', undefined]) {
      expect(() => buildShippingOptions(bad)).toThrow(TypeError);
    }
  });
});
