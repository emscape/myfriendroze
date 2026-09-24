const crypto = require('crypto');

// HMAC-SHA256 over email:firstName:lastName:issuedAt, keyed on a
// caller-supplied secret (NEWSLETTER_CONFIRM_SECRET in production, a
// literal in tests). No fallback of its own -- same convention as
// lib/unsubscribeToken.js. firstName/lastName are optional on a signup, so
// they're normalized to '' rather than the literal string "undefined".
function generateConfirmationToken({ email, firstName, lastName, issuedAt }, secret) {
  return crypto.createHmac('sha256', secret)
    .update(`${email}:${firstName || ''}:${lastName || ''}:${issuedAt}`)
    .digest('hex');
}

// Same non-string-safe / length-safe / timing-safe guards as
// verifyUnsubscribeToken (lib/unsubscribeToken.js) -- a malformed or forged
// token must fail verification cleanly, never throw.
function verifyConfirmationToken({ email, firstName, lastName, issuedAt, token }, secret) {
  if (typeof token !== 'string') {
    return false;
  }

  const expected = generateConfirmationToken({ email, firstName, lastName, issuedAt }, secret);
  const tokenBuffer = Buffer.from(token, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

// Pure. issuedAt arrives as a string from a URL query param, so this must
// safely reject anything that isn't a valid finite number (missing,
// non-numeric, array-valued from a repeated query param) rather than doing
// arithmetic with NaN, which would make `now - NaN > maxAgeMs` always false
// and treat a malformed link as never-expiring.
function isConfirmationTokenExpired(issuedAt, now, maxAgeMs) {
  const issuedAtNum = Number(issuedAt);
  if (!Number.isFinite(issuedAtNum)) {
    return true;
  }
  return now - issuedAtNum > maxAgeMs;
}

module.exports = { generateConfirmationToken, verifyConfirmationToken, isConfirmationTokenExpired };
