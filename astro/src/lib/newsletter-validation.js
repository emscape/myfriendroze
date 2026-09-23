// Pure request-shape validation for the newsletter signup API route —
// extracted so it's unit-testable without spinning up an Astro
// route/Request object, same pattern as checkout-validation.js.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNewsletterRequest(body) {
  const { email } = body || {};

  // RegExp.test() coerces its argument to a string, so a non-string value
  // that happens to stringify to something email-shaped (e.g. the
  // single-element array ['roze@example.com']) would otherwise pass this
  // check, then throw downstream where the real string API (.toLowerCase())
  // is called on the non-string value instead.
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return { valid: false, error: 'A valid email address is required' };
  }

  return { valid: true };
}
