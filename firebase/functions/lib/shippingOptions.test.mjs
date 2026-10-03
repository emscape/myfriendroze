import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import — see pricing.test.mjs for why.
const require = createRequire(import.meta.url);
const {
  subtotalCents,
  buildShippingOptions,
  FREE_SHIPPING_THRESHOLD_CENTS,
  FLAT_SHIPPING_CENTS,
  BUNDLE_SURCHARGE_CENTS,
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
  const ONE_POT = [{ category: 'pottery', quantity: 1 }];

  it('free shipping starts at $50.00, with a $10 base under that', () => {
    expect(FREE_SHIPPING_THRESHOLD_CENTS).toBe(5000);
    expect(FLAT_SHIPPING_CENTS).toBe(1000);
  });

  it('adds $2 per extra plant and $5 per extra ceramic piece', () => {
    expect(BUNDLE_SURCHARGE_CENTS).toEqual({ plant: 200, pottery: 500 });
  });

  it('offers only the mail option to a shopper outside Los Angeles', () => {
    expect(amountsByMethod(buildShippingOptions(4999, ONE_POT))).toEqual({ shipping: 1000 });
    expect(amountsByMethod(buildShippingOptions(5000, ONE_POT, { local: false }))).toEqual({ free_shipping: 0 });
  });

  it('charges $10 for a single item under $50, alongside free pickup in Los Angeles', () => {
    expect(amountsByMethod(buildShippingOptions(4999, ONE_POT, LOCAL))).toEqual({
      shipping: 1000,
      local_pickup: 0,
    });
    expect(amountsByMethod(buildShippingOptions(1200, [{ category: 'plant', quantity: 1 }]))).toEqual({
      shipping: 1000,
    });
  });

  it('adds $2 for each plant after the first', () => {
    expect(amountsByMethod(buildShippingOptions(3600, [{ category: 'plant', quantity: 3 }]))).toEqual({
      shipping: 1400,
    });
  });

  it('adds $5 for each ceramic piece after the first', () => {
    const twoPots = [
      { category: 'pottery', quantity: 1 },
      { category: 'pottery', quantity: 1 },
    ];
    expect(amountsByMethod(buildShippingOptions(4000, twoPots))).toEqual({ shipping: 1500 });
  });

  it('lets the $10 base cover a ceramic piece in a mixed order, whatever order items are listed in', () => {
    const plantsFirst = [
      { category: 'plant', quantity: 2 },
      { category: 'pottery', quantity: 1 },
    ];
    expect(amountsByMethod(buildShippingOptions(4800, plantsFirst))).toEqual({ shipping: 1400 });
    expect(amountsByMethod(buildShippingOptions(4800, [...plantsFirst].reverse()))).toEqual({ shipping: 1400 });
  });

  it('charges the ceramic rate for an "other" or missing category, matching pricing.js', () => {
    expect(
      amountsByMethod(buildShippingOptions(3000, [{ category: 'other', quantity: 1 }, { quantity: 1 }]))
    ).toEqual({ shipping: 1500 });
  });

  it('ships free at exactly $50, however many items', () => {
    expect(amountsByMethod(buildShippingOptions(5000, [{ category: 'plant', quantity: 10 }], LOCAL))).toEqual({
      free_shipping: 0,
      local_pickup: 0,
    });
  });

  it('ships free over $50', () => {
    expect(amountsByMethod(buildShippingOptions(12000, ONE_POT))).toHaveProperty('free_shipping', 0);
  });

  it('lists the mail option first, so Stripe preselects it', () => {
    expect(buildShippingOptions(1000, ONE_POT)[0].shipping_rate_data.metadata.method).toBe('shipping');
    expect(buildShippingOptions(9000, ONE_POT)[0].shipping_rate_data.metadata.method).toBe('free_shipping');
  });

  // Free shipping is ground shipping; faster options may be sold later.
  it('names the mail options as ground shipping', () => {
    const nameOf = (options) => options[0].shipping_rate_data.display_name;

    expect(nameOf(buildShippingOptions(1000, ONE_POT))).toBe('Ground shipping');
    expect(nameOf(buildShippingOptions(9000, ONE_POT))).toBe('Free ground shipping');
  });

  it('names pickup as Los Angeles and offers no local delivery', () => {
    const names = Object.fromEntries(
      buildShippingOptions(1000, ONE_POT, LOCAL).map((o) => [o.shipping_rate_data.metadata.method, o.shipping_rate_data.display_name])
    );
    expect(names).not.toHaveProperty('local_delivery');
    expect(names.local_pickup).toBe('Local pickup — Los Angeles');
  });

  it('marks every rate tax-exclusive with the shipping tax code, so Stripe Tax decides whether shipping is taxed', () => {
    for (const option of buildShippingOptions(1000, ONE_POT, LOCAL)) {
      expect(option.shipping_rate_data.tax_behavior).toBe('exclusive');
      expect(option.shipping_rate_data.tax_code).toBe('txcd_92010001');
    }
  });

  it('builds fixed-amount USD rates', () => {
    for (const option of buildShippingOptions(1000, ONE_POT, LOCAL)) {
      expect(option.shipping_rate_data.type).toBe('fixed_amount');
      expect(option.shipping_rate_data.fixed_amount.currency).toBe('usd');
    }
  });

  it('rejects a subtotal that is not a non-negative integer number of cents', () => {
    for (const bad of [-1, 12.5, NaN, '5000', undefined]) {
      expect(() => buildShippingOptions(bad, ONE_POT)).toThrow(TypeError);
    }
  });

  it('rejects a missing or empty item list, or a quantity that is not a positive integer', () => {
    for (const bad of [undefined, [], [{ category: 'plant', quantity: 0 }], [{ category: 'plant', quantity: 1.5 }]]) {
      expect(() => buildShippingOptions(1000, bad)).toThrow(TypeError);
    }
  });
});
