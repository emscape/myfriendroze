import { describe, it, expect } from 'vitest';
import { orderDataToConfirmationEmailParams } from './emailPayload.js';

function fullOrder(overrides = {}) {
  return {
    status: 'paid',
    stripeSessionId: 'cs_test_abc123',
    stripePaymentIntentId: 'pi_test_xyz',
    customer: { email: 'buyer@example.com', name: 'Buyer Name', phone: '555-1234' },
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
    notes: 'gift wrap please',
    ...overrides,
  };
}

describe('orderDataToConfirmationEmailParams', () => {
  it('maps a full order to Brevo template params', () => {
    const params = orderDataToConfirmationEmailParams(fullOrder());

    expect(params).toEqual({
      EMAIL: 'buyer@example.com',
      ORDER_NUMBER: 'cs_test_abc123',
      ORDER_TOTAL: '$70.00',
      CUSTOMER_NAME: 'Buyer Name',
      ITEMS: [{ name: 'Blue Branches', qty: 1, amountTotal: 70 }],
      SHIPPING_ADDRESS: '123 Main St, Springfield, CA 90210, US',
    });
  });

  it('formats a shipping address with line2 when present', () => {
    const order = fullOrder({
      shippingAddress: {
        name: 'Buyer Name',
        line1: '123 Main St',
        line2: 'Apt 4B',
        city: 'Springfield',
        state: 'CA',
        postalCode: '90210',
        country: 'US',
      },
    });

    const params = orderDataToConfirmationEmailParams(order);

    expect(params.SHIPPING_ADDRESS).toBe('123 Main St, Apt 4B, Springfield, CA 90210, US');
  });

  it('defaults SHIPPING_ADDRESS to an empty string when null', () => {
    const order = fullOrder({ shippingAddress: null });

    const params = orderDataToConfirmationEmailParams(order);

    expect(params.SHIPPING_ADDRESS).toBe('');
  });

  it('defaults CUSTOMER_NAME to an empty string when absent', () => {
    const order = fullOrder({ customer: { email: 'buyer@example.com', name: null, phone: null } });

    const params = orderDataToConfirmationEmailParams(order);

    expect(params.CUSTOMER_NAME).toBe('');
  });

  it('formats ORDER_TOTAL with two decimal places even for whole dollar amounts', () => {
    const order = fullOrder({ total: 45.5 });

    const params = orderDataToConfirmationEmailParams(order);

    expect(params.ORDER_TOTAL).toBe('$45.50');
  });
});
