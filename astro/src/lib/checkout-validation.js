// Pure request-shape validation for the checkout API route — extracted so
// it's unit-testable without spinning up an Astro route/Request object,
// same pattern as this project's other astro/src/lib/*.js modules.
//
// Deliberately does not validate price/name/description on items, even if
// the client sends them — those fields are ignored server-side regardless
// (see firebase/functions/lib/pricing.js), so there's nothing to check
// here beyond sku/qty shape.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCheckoutRequest(body) {
  const { customer, items } = body || {};

  if (!customer || !customer.email || !EMAIL_RE.test(customer.email)) {
    return { valid: false, error: 'A valid customer email is required' };
  }
  if (!customer.name) {
    return { valid: false, error: 'Customer name is required' };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, error: 'At least one item is required' };
  }
  for (const item of items) {
    if (!item.sku) {
      return { valid: false, error: 'Each item must have a sku' };
    }
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      return { valid: false, error: 'Each item must have a positive integer qty' };
    }
  }

  return { valid: true };
}
