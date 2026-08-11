// The Brevo API call only — extracted from the original orderConfirmation.js,
// which conflated "write the order to Firestore" with "send the email".
// stripeWebhook.js now owns order creation (idempotently, keyed on the
// Stripe session ID); this module's only job is sending the email once
// that's decided.
//
// fetchImpl defaults to the global fetch (Node 22 provides it natively —
// no node-fetch dependency needed for new code) but is injectable for
// tests.

async function sendOrderConfirmationEmail({ apiKey, sender, templateId, email, params, fetchImpl = fetch }) {
  const payload = {
    sender,
    to: [{ email }],
    templateId,
    params,
  };

  const response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo API request failed with status ${response.status}: ${errorBody}`);
  }

  return response;
}

module.exports = { sendOrderConfirmationEmail };
