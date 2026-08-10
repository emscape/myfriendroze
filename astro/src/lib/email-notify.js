// Email Notification Module
// Sends alerts for USPS rate parsing errors via Brevo

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const ADMIN_EMAIL = 'me@hello.emily.dev';
const SENDER_EMAIL = 'noreply@myfriendroze.com';
const SENDER_NAME = 'Roze Shipping System';

// Rate limit: only send one email per error per hour
let lastNotificationTime = null;
const NOTIFICATION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/**
 * Send an email notification about a USPS rate parsing error
 * @param {string} errorMessage - The error message to include
 */
export async function sendParsingErrorNotification(errorMessage) {
  // Check cooldown
  if (lastNotificationTime && (Date.now() - lastNotificationTime < NOTIFICATION_COOLDOWN_MS)) {
    console.log('[Email Notify] Skipping notification - cooldown active');
    return;
  }

  const apiKey = import.meta.env.BREVO_API_KEY || process.env.BREVO_API_KEY;

  if (!apiKey) {
    console.warn('[Email Notify] BREVO_API_KEY not set - cannot send notification');
    return;
  }

  const timestamp = new Date().toISOString();
  const subject = '⚠️ USPS Rate Parsing Error - Action Required';

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #d32f2f;">USPS Rate Parsing Error</h2>

      <p>The shipping calculator encountered an error while fetching/parsing the USPS Notice 123 rate table.</p>

      <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 15px; margin: 20px 0;">
        <strong>Error:</strong><br>
        <code style="color: #856404;">${errorMessage}</code>
      </div>

      <p><strong>What this means:</strong></p>
      <ul>
        <li>The shipping calculator is using <strong>fallback rates</strong> (last known good rates)</li>
        <li>Customers will still see shipping estimates, but they may be outdated</li>
        <li>This usually means USPS changed their website structure</li>
      </ul>

      <p><strong>Action required:</strong></p>
      <ol>
        <li>Visit <a href="https://pe.usps.com/text/dmm300/Notice123.htm">USPS Notice 123</a> to check the current format</li>
        <li>Update the rate parser in <code>usps-rate-fetcher.js</code> if needed</li>
        <li>Or manually update <code>usps-rates.js</code> with current rates</li>
      </ol>

      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">

      <p style="color: #666; font-size: 12px;">
        Timestamp: ${timestamp}<br>
        Source: myfriendroze Shipping Calculator
      </p>
    </div>
  `;

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: SENDER_EMAIL, name: SENDER_NAME },
        to: [{ email: ADMIN_EMAIL, name: 'Emily' }],
        subject,
        htmlContent,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brevo API error: ${response.status} - ${errorText}`);
    }

    lastNotificationTime = Date.now();
    console.log(`[Email Notify] Sent parsing error notification to ${ADMIN_EMAIL}`);

  } catch (error) {
    console.error('[Email Notify] Failed to send email:', error.message);
    throw error;
  }
}

/**
 * Send a test notification (for debugging)
 */
export async function sendTestNotification() {
  return sendParsingErrorNotification('This is a test notification to verify email delivery is working.');
}
