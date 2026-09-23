// Pure helpers for newsletterSignup.js — extracted so the record shape and
// email personalization are unit-testable without Firestore/Brevo, same
// pattern as lib/pricing.js.

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
 * Escapes the five HTML-significant characters -- firstName is
 * request-controlled and gets interpolated straight into an email Brevo
 * actually sends, so an unescaped value could inject arbitrary markup into
 * a message delivered under this site's trusted sender identity.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Personalizes the welcome email greeting when a first name was given,
 * falling back to the original generic greeting otherwise.
 * @param {{ firstName?: string }} input
 * @returns {string}
 */
function buildWelcomeEmailHtml({ firstName }) {
  const greeting =
    typeof firstName === 'string' && firstName.trim()
      ? `Hi ${escapeHtml(firstName.trim())},`
      : 'Hi there,';

  return `
          <div style="font-family: Arial, sans-serif; background: #f9f9f9; padding: 32px;">
            <h2 style="color: #4CAF50;">Welcome to MyFriendRoze!</h2>
            <p>${greeting}</p>
            <p>Thank you for signing up for our newsletter. We're excited to have you join our community of plant lovers and creative souls!</p>
            <ul>
              <li>🌱 Get exclusive updates and offers</li>
              <li>🌸 Be the first to know about new products and events</li>
              <li>💌 Tips, inspiration, and more delivered to your inbox</li>
            </ul>
            <p>If you have any questions, just reply to this email—we love hearing from you!</p>
            <p style="margin-top:32px; color:#888; font-size:12px;">You are receiving this email because you signed up at myfriendroze.com.</p>
          </div>
        `;
}

module.exports = { buildSignupRecord, buildWelcomeEmailHtml };
