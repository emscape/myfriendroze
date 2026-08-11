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
      items: [{ name: 'Blue Branches', qty: 1, amountTotal: 70 }],
      total: 70,
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
    });
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
      { description: 'Blue Branches', quantity: 2, amount_total: 14000 },
      { description: 'Pineapple Planter', quantity: 1, amount_total: 4550 },
    ];

    const order = sessionToOrderData(baseSession(), twoLineItems);

    expect(order.items).toEqual([
      { name: 'Blue Branches', qty: 2, amountTotal: 140 },
      { name: 'Pineapple Planter', qty: 1, amountTotal: 45.5 },
    ]);
  });

  it('defaults customer name/phone and notes to null when metadata is entirely absent', () => {
    const session = baseSession({ metadata: undefined });

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
