// Thin Brevo transactional-email POST, shared by any Cloud Function that
// needs to send one. fetchImpl defaults to the global fetch (Node 22
// provides it natively) but is injectable for tests.
//
// Deliberately does NOT include the raw Brevo response body in a failure's
// error message -- Brevo's error text can echo back caller-supplied data
// (e.g. the recipient's address in an "invalid email" error), and this
// error ends up in Cloud Logging via callers that log a failed send's
// reason for diagnostics. Only the HTTP status code is safe to surface
// there.
async function sendBrevoEmail({ apiKey, payload, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Brevo API request failed with status ${response.status}`);
  }

  return response;
}

module.exports = { sendBrevoEmail };
