// Pure request-shape validation for the newsletter signup API route —
// extracted so it's unit-testable without spinning up an Astro
// route/Request object, same pattern as checkout-validation.js.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNewsletterRequest(body) {
  const { email } = body || {};

  if (!email || !EMAIL_RE.test(email)) {
    return { valid: false, error: 'A valid email address is required' };
  }

  return { valid: true };
}
