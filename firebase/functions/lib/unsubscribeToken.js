const crypto = require('crypto');

// HMAC-SHA256 over `${email}:${type}`, keyed on a caller-supplied secret.
// The secret must come from the caller (defineSecret in production, a
// literal in tests) -- this module has no fallback of its own.
function generateUnsubscribeToken(email, type, secret) {
  return crypto.createHmac('sha256', secret)
    .update(`${email}:${type}`)
    .digest('hex');
}

// crypto.timingSafeEqual throws (rather than returning false) when its two
// buffers differ in length, so any malformed/short token query param would
// otherwise crash the caller as an unhandled error instead of failing
// verification cleanly. Buffer.from(token, 'utf8') has the same problem for
// a non-string token -- Express parses a repeated query param like
// ?token=a&token=b into an array, not a string, and Buffer.from rejects
// that before timingSafeEqual is ever reached.
function verifyUnsubscribeToken(email, type, token, secret) {
  if (typeof token !== 'string') {
    return false;
  }

  const expected = generateUnsubscribeToken(email, type, secret);
  const tokenBuffer = Buffer.from(token, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

module.exports = { generateUnsubscribeToken, verifyUnsubscribeToken };
