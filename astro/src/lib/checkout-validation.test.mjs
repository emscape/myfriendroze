import { describe, it, expect } from 'vitest';
import { validateCheckoutRequest } from './checkout-validation.js';

function validBody(overrides = {}) {
  return {
    customer: { email: 'buyer@example.com', name: 'Buyer Name' },
    items: [{ sku: 'sku-1', qty: 1 }],
    ...overrides,
  };
}

describe('validateCheckoutRequest', () => {
  it('accepts a valid request', () => {
    expect(validateCheckoutRequest(validBody())).toEqual({ valid: true });
  });

  it('rejects a missing customer', () => {
    const result = validateCheckoutRequest(validBody({ customer: undefined }));
    expect(result.valid).toBe(false);
  });

  it('rejects a missing or invalid email', () => {
    expect(
      validateCheckoutRequest(validBody({ customer: { email: '', name: 'Buyer' } })).valid
    ).toBe(false);
    expect(
      validateCheckoutRequest(validBody({ customer: { email: 'not-an-email', name: 'Buyer' } }))
        .valid
    ).toBe(false);
  });

  it('rejects a missing name', () => {
    const result = validateCheckoutRequest(
      validBody({ customer: { email: 'buyer@example.com', name: '' } })
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a missing or empty items array', () => {
    expect(validateCheckoutRequest(validBody({ items: undefined })).valid).toBe(false);
    expect(validateCheckoutRequest(validBody({ items: [] })).valid).toBe(false);
  });

  it('rejects an item missing a sku', () => {
    const result = validateCheckoutRequest(validBody({ items: [{ qty: 1 }] }));
    expect(result.valid).toBe(false);
  });

  it('rejects an item with a non-positive quantity', () => {
    const result = validateCheckoutRequest(validBody({ items: [{ sku: 'sku-1', qty: 0 }] }));
    expect(result.valid).toBe(false);
  });

  it('ignores any price/name/description the client sends on an item', () => {
    // Same security guarantee as lib/pricing.js on the Functions side —
    // documented here so it's obvious this validator was never meant to
    // check price fields at all, not that it was overlooked.
    const result = validateCheckoutRequest(
      validBody({ items: [{ sku: 'sku-1', qty: 1, price: 0.01, name: 'Fake' }] })
    );
    expect(result.valid).toBe(true);
  });
});
