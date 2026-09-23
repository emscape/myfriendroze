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
// verification cleanly.
function verifyUnsubscribeToken(email, type, token, secret) {
  const expected = generateUnsubscribeToken(email, type, secret);
  const tokenBuffer = Buffer.from(token, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

module.exports = { generateUnsubscribeToken, verifyUnsubscribeToken };
