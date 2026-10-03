import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// Loaded via require(), not a static ESM import, so this test exercises the
// exact same module instance stripeWebhook.js's CommonJS require() creates
// — importing the same CJS file through both loaders creates two separate
// instrumented instances, and v8 coverage merging across them was
// under-reporting real coverage for this file (92% standalone vs. 60% in
// the full suite) rather than properly unioning the two.
const require = createRequire(import.meta.url);
const { sessionToOrderData } = require('./orderFromSession.js');

function baseSession(overrides = {}) {
  return {
    id: 'cs_test_abc123',
    payment_intent: 'pi_test_xyz789',
    customer_details: { email: 'buyer@example.com' },
    amount_total: 7000,
    currency: 'usd',
    metadata: { customerName: 'Buyer Name' },
    shipping_details: {
      name: 'Buyer Name',
      address: {
        line1: '123 Main St',
        city: 'Springfield',
        state: 'CA',
        postal_code: '90210',
        country: 'US',
      },
    },
    ...overrides,
  };
}

const lineItems = [
  { description: 'Blue Branches', quantity: 1, amount_total: 7000 },
];

describe('sessionToOrderData', () => {
  it('maps a full session + line items to the order-doc shape', () => {
    const order = sessionToOrderData(baseSession(), lineItems);

    expect(order).toEqual({
      status: 'paid',
      stripeSessionId: 'cs_test_abc123',
      stripePaymentIntentId: 'pi_test_xyz789',
      customer: { email: 'buyer@example.com', name: 'Buyer Name', phone: null },
      items: [{ name: 'Blue Branches', qty: 1, amountSubtotal: null, amountTotal: 70 }],
      total: 70,
      // No total_details on this session, so the tax is unknown.
      tax: null,
      currency: 'usd',
      shippingAddress: {
        name: 'Buyer Name',
        line1: '123 Main St',
        line2: null,
        city: 'Springfield',
        state: 'CA',
        postalCode: '90210',
        country: 'US',
      },
      notes: null,
      shipping: null,
    });
  });

  it("records each item's amount before tax alongside its total after tax", () => {
    const taxed = [{ description: 'Blue Branches', quantity: 1, amount_subtotal: 7000, amount_total: 7718 }];

    const order = sessionToOrderData(baseSession(), taxed);

    expect(order.items).toEqual([{ name: 'Blue Branches', qty: 1, amountSubtotal: 70, amountTotal: 77.18 }]);
  });

  it('leaves amountSubtotal null when Stripe gives no before-tax amount', () => {
    const order = sessionToOrderData(baseSession(), lineItems);

    expect(order.items[0].amountSubtotal).toBeNull();
  });

  it('records the sales tax Stripe charged, in dollars', () => {
    const order = sessionToOrderData(baseSession({ total_details: { amount_tax: 667 } }), lineItems);

    expect(order.tax).toBe(6.67);
  });

  it('records zero tax as 0, not null, for an order Stripe charged no tax on', () => {
    const order = sessionToOrderData(baseSession({ total_details: { amount_tax: 0 } }), lineItems);

    expect(order.tax).toBe(0);
  });

  it("records the chosen shipping option's method, name and amount", () => {
    const session = baseSession({ shipping_cost: { amount_total: 1000, shipping_rate: 'shr_123' } });
    const shippingRate = { id: 'shr_123', display_name: 'Shipping', metadata: { method: 'shipping' } };

    const order = sessionToOrderData(session, lineItems, shippingRate);

    expect(order.shipping).toEqual({ method: 'shipping', label: 'Shipping', amount: 10, outsideLocalArea: false });
  });

  it('tells a free local pickup apart from free shipping by the method, not the amount', () => {
    const session = baseSession({ shipping_cost: { amount_total: 0, shipping_rate: 'shr_456' } });
    const shippingRate = { id: 'shr_456', display_name: 'Local pickup — Los Angeles', metadata: { method: 'local_pickup' } };

    const order = sessionToOrderData(session, lineItems, shippingRate);

    expect(order.shipping).toEqual({
      method: 'local_pickup',
      label: 'Local pickup — Los Angeles',
      amount: 0,
      outsideLocalArea: false,
    });
  });

  it('reads the shipping address from collected_information, where current Stripe API versions put it', () => {
    const session = baseSession({
      shipping_details: undefined,
      collected_information: {
        shipping_details: {
          name: 'Buyer Name',
          address: { line1: '9 Elm St', city: 'Pasadena', state: 'CA', postal_code: '91101', country: 'US' },
        },
      },
    });

    const order = sessionToOrderData(session, lineItems);

    expect(order.shippingAddress).toEqual({
      name: 'Buyer Name',
      line1: '9 Elm St',
      line2: null,
      city: 'Pasadena',
      state: 'CA',
      postalCode: '91101',
      country: 'US',
    });
  });

  describe('flagging pickup orders outside Los Angeles', () => {
    const pickup = { id: 'shr_p', display_name: 'Local pickup — Los Angeles', metadata: { method: 'local_pickup' } };
    const shipping = { id: 'shr_s', display_name: 'Shipping', metadata: { method: 'shipping' } };
    const cost = { shipping_cost: { amount_total: 0, shipping_rate: 'shr_p' } };

    function sessionTo(postalCode) {
      return baseSession({
        ...cost,
        shipping_details: { name: 'Buyer Name', address: { line1: '1 St', postal_code: postalCode, country: 'US' } },
      });
    }

    it('flags pickup by a shopper in another state', () => {
      expect(sessionToOrderData(sessionTo('10001'), lineItems, pickup).shipping.outsideLocalArea).toBe(true);
    });

    it('flags pickup by a shopper elsewhere in California', () => {
      expect(sessionToOrderData(sessionTo('94103'), lineItems, pickup).shipping.outsideLocalArea).toBe(true);
    });

    it('does not flag a pickup order with a Los Angeles address, including ZIP+4', () => {
      expect(sessionToOrderData(sessionTo('90065-1234'), lineItems, pickup).shipping.outsideLocalArea).toBe(false);
    });

    it('flags a pickup order whose address is missing, since it cannot be confirmed', () => {
      const session = baseSession({ ...cost, shipping_details: undefined });
      expect(sessionToOrderData(session, lineItems, pickup).shipping.outsideLocalArea).toBe(true);
    });

    it('never flags mail shipping, wherever it goes', () => {
      expect(sessionToOrderData(sessionTo('10001'), lineItems, shipping).shipping.outsideLocalArea).toBe(false);
    });
  });

  it('keeps the shipping amount when the shipping rate could not be looked up', () => {
    const session = baseSession({ shipping_cost: { amount_total: 3000, shipping_rate: 'shr_789' } });

    const order = sessionToOrderData(session, lineItems);

    expect(order.shipping).toEqual({ method: null, label: null, amount: 30, outsideLocalArea: false });
  });

  it('does not throw and sets shippingAddress to null when shipping_details is absent', () => {
    const session = baseSession({ shipping_details: undefined });

    const order = sessionToOrderData(session, lineItems);

    expect(order.shippingAddress).toBeNull();
  });

  it('sets customer.phone and notes from metadata when present', () => {
    const session = baseSession({
      metadata: { customerName: 'Buyer Name', customerPhone: '555-1234', notes: 'gift wrap' },
    });

    const order = sessionToOrderData(session, lineItems);

    expect(order.customer.phone).toBe('555-1234');
    expect(order.notes).toBe('gift wrap');
  });

  it('maps multiple line items independently', () => {
    const twoLineItems = [
      { description: 'Blue Branches', quantity: 2, amount_subtotal: 14000, amount_total: 14000 },
      { description: 'Pineapple Planter', quantity: 1, amount_subtotal: 4550, amount_total: 4550 },
    ];

    const order = sessionToOrderData(baseSession(), twoLineItems);

    expect(order.items).toEqual([
      { name: 'Blue Branches', qty: 2, amountSubtotal: 140, amountTotal: 140 },
      { name: 'Pineapple Planter', qty: 1, amountSubtotal: 45.5, amountTotal: 45.5 },
    ]);
  });

  // Checkouts now go straight to Stripe, which collects these itself;
  // metadata is only present on sessions created before that change.
  it('takes name, phone and notes from what Stripe collected', () => {
    const session = baseSession({
      metadata: {},
      customer_details: { email: 'buyer@example.com', name: 'Card Name', phone: '+15551234567' },
      custom_fields: [{ key: 'notes', type: 'text', text: { value: 'gift wrap' } }],
    });

    const order = sessionToOrderData(session, lineItems);

    expect(order.customer).toEqual({ email: 'buyer@example.com', name: 'Card Name', phone: '+15551234567' });
    expect(order.notes).toBe('gift wrap');
  });

  it('falls back to the shipping name when Stripe has no customer name', () => {
    const session = baseSession({ metadata: undefined, customer_details: { email: 'buyer@example.com' } });

    expect(sessionToOrderData(session, lineItems).customer.name).toBe('Buyer Name');
  });

  it('treats an empty special-requests field as no notes', () => {
    const session = baseSession({
      custom_fields: [{ key: 'notes', type: 'text', text: { value: null } }],
    });

    expect(sessionToOrderData(session, lineItems).notes).toBeNull();
  });

  it('defaults customer name/phone and notes to null when nothing supplies them', () => {
    const session = baseSession({ metadata: undefined, shipping_details: undefined });

    const order = sessionToOrderData(session, lineItems);

    expect(order.customer.name).toBeNull();
    expect(order.customer.phone).toBeNull();
    expect(order.notes).toBeNull();
  });

  it('defaults individually missing shipping address fields to null (e.g. no line2)', () => {
    const session = baseSession({
      shipping_details: {
        name: undefined,
        address: {
          line1: '123 Main St',
          city: 'Springfield',
          state: 'CA',
          postal_code: '90210',
          country: 'US',
          // line2 intentionally omitted — realistic for most US addresses
        },
      },
    });

    const order = sessionToOrderData(session, lineItems);

    expect(order.shippingAddress.name).toBeNull();
    expect(order.shippingAddress.line2).toBeNull();
    expect(order.shippingAddress.line1).toBe('123 Main St');
  });

  it('falls back to session.customer_email when customer_details is absent', () => {
    const session = baseSession({ customer_details: undefined, customer_email: 'fallback@example.com' });

    const order = sessionToOrderData(session, lineItems);

    expect(order.customer.email).toBe('fallback@example.com');
  });

  it('defaults email to null when neither customer_details nor customer_email is present', () => {
    const session = baseSession({ customer_details: undefined, customer_email: undefined });

    const order = sessionToOrderData(session, lineItems);

    expect(order.customer.email).toBeNull();
  });

  it('defaults remaining individually missing address fields to null', () => {
    const session = baseSession({
      shipping_details: { name: 'Buyer Name', address: {} },
    });

    const order = sessionToOrderData(session, lineItems);

    expect(order.shippingAddress).toEqual({
      name: 'Buyer Name',
      line1: null,
      line2: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
    });
  });
});
