// Pure helpers shared by newsletterSignup.js and confirmNewsletterSignup.js
// -- extracted so the record shape, confirm-link building, and rate-limit
// math are unit-testable without Firestore/Brevo, same pattern as
// lib/pricing.js.

// Matches eventNotification.js's UNSUBSCRIBE_BASE_URL constant -- the
// recipient clicks this from their email client, not from the site's own
// JS bundle, so the dev/prod URL-switching that
// astro/src/lib/newsletter-signup-url.js exists for doesn't apply here.
const CONFIRM_BASE_URL = 'https://us-west1-myfriendroze-platform.cloudfunctions.net/confirmNewsletterSignup';

/**
 * Firestore fields for a new newsletter_signups doc (timestamp is added by
 * the caller via admin.firestore.FieldValue.serverTimestamp(), which isn't
 * something a pure function can produce).
 * @param {{ email: string, firstName?: string, lastName?: string }} input
 * @returns {{ email: string, firstName?: string, lastName?: string }}
 */
function buildSignupRecord({ email, firstName, lastName }) {
  const record = {
    email: email.toLowerCase().trim(),
    // A new signup always opts in -- unsubscribe.js flips this to false
    // later, and newsletterSignup.js checks this same field to tell a
    // genuine resubscribe apart from an already-active subscriber.
    preferences: { newsletter: true },
  };
  if (typeof firstName === 'string' && firstName.trim()) {
    record.firstName = firstName.trim();
  }
  if (typeof lastName === 'string' && lastName.trim()) {
    record.lastName = lastName.trim();
  }
  return record;
}

/**
 * Builds the confirm-signup link emailed to the visitor -- carries every
 * field the confirm step needs (confirmNewsletterSignup.js writes nothing
 * to Firestore until this link is clicked, so the signed token itself is
 * the only record of the pending signup). URLSearchParams handles query
 * encoding, distinct from the HTML-escaping buildWelcomeEmailHtml used to
 * do -- this value goes into a URL, not an HTML document.
 * @param {{ email: string, firstName?: string, lastName?: string, issuedAt: number, token: string }} input
 * @returns {string}
 */
function buildConfirmUrl({ email, firstName, lastName, issuedAt, token }) {
  const params = new URLSearchParams({ email, issuedAt: String(issuedAt), token });
  if (typeof firstName === 'string' && firstName.trim()) {
    params.set('firstName', firstName.trim());
  }
  if (typeof lastName === 'string' && lastName.trim()) {
    params.set('lastName', lastName.trim());
  }
  return `${CONFIRM_BASE_URL}?${params.toString()}`;
}

/**
 * Update payload for an existing newsletter_signups doc (resubscribe,
 * delivery retry, or legacy backfill) -- merges the existing preferences
 * map instead of replacing it wholesale, since unsubscribe.js's "all" type
 * sets preferences to { newsletter: false, events: false, orders: true },
 * and orders: true is deliberately preserved there for legal/record-
 * keeping reasons. Only `newsletter` should ever flip here.
 * @param {{ preferences?: Record<string, boolean> }} existingData
 * @param {{ email: string, firstName?: string, lastName?: string }} input
 */
function buildExistingDocUpdate(existingData, { email, firstName, lastName }) {
  const { preferences, ...rest } = buildSignupRecord({ email, firstName, lastName });
  return {
    ...rest,
    preferences: { ...(existingData.preferences || {}), ...preferences },
  };
}

const MAX_NAME_LENGTH = 50;

/**
 * This handler is directly publicly callable (invoker: 'public'), not only
 * reachable through the astro proxy -- a caller bypassing the proxy could
 * otherwise submit an arbitrarily long name with no boundary check. The
 * removed subscribe.js/createSubscription capped each name at 50
 * characters; this restores an equivalent limit.
 * @param {{ firstName?: string, lastName?: string }} input
 * @returns {{ valid: boolean, error?: string }}
 */
function validateNameLengths({ firstName, lastName }) {
  if (typeof firstName === 'string' && firstName.length > MAX_NAME_LENGTH) {
    return { valid: false, error: `First name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  if (typeof lastName === 'string' && lastName.length > MAX_NAME_LENGTH) {
    return { valid: false, error: `Last name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  return { valid: true };
}

/**
 * Pure sliding-window rate limit decision -- separated from the Firestore
 * read/transaction that actually persists the counter so the window/reset
 * math is unit-testable without live infrastructure.
 * @param {{ windowStart: number, count: number } | null} existing
 * @param {number} now epoch ms
 * @param {{ maxRequests: number, windowMs: number }} config
 * @returns {{ allowed: boolean, newState: { windowStart: number, count: number } }}
 */
function evaluateRateLimit(existing, now, { maxRequests, windowMs }) {
  const windowExpired = !existing || now - existing.windowStart >= windowMs;
  const windowStart = windowExpired ? now : existing.windowStart;
  const count = windowExpired ? 0 : existing.count;

  if (count >= maxRequests) {
    // Denial leaves state untouched -- a rejected request shouldn't reset
    // or extend the window for whoever tries next.
    return { allowed: false, newState: existing };
  }
  return { allowed: true, newState: { windowStart, count: count + 1 } };
}

module.exports = {
  buildSignupRecord,
  buildConfirmUrl,
  buildExistingDocUpdate,
  validateNameLengths,
  evaluateRateLimit,
};
