const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { verifyUnsubscribeToken } = require("./lib/unsubscribeToken");
const { escapeHtml } = require("./lib/escapeHtml");
const { page } = require("./lib/htmlPage");

if (!admin.apps.length) {
  admin.initializeApp();
}

const unsubscribeSecret = defineSecret("UNSUBSCRIBE_SECRET");

// Matches lib/newsletter-signup.js's CONFIRM_BASE_URL constant -- used here
// as the interstitial form's explicit POST target. See
// renderUnsubscribeInterstitial's comment for why GET can't perform the
// mutation directly.
const UNSUBSCRIBE_BASE_URL = "https://us-west1-myfriendroze-platform.cloudfunctions.net/unsubscribe";

// GET must stay side-effect-free (RFC 7231 "safe methods"), same reasoning
// and same fix shape as confirmNewsletterSignup.js's interstitial: email
// security scanners (Microsoft Safe Links, Proofpoint, Mimecast, etc.)
// routinely prefetch every link in an incoming email, including these
// unsubscribe links placed directly in the welcome email -- which would
// silently unsubscribe a real recipient who never clicked anything. Only a
// real POST -- a hidden-field form a prefetcher won't submit -- performs
// the actual preference update.
function renderUnsubscribeInterstitial({ email, type, token }) {
  const hiddenField = (name, value) =>
    value === undefined ? '' : `<input type="hidden" name="${name}" value="${escapeHtml(String(value))}">`;

  return page(
    'Unsubscribe from myfriendroze', '#3d081b',
    `
      <p>Click below to confirm you'd like to stop receiving these emails.</p>
      <form method="POST" action="${UNSUBSCRIBE_BASE_URL}" style="margin-top:24px;">
        ${hiddenField('email', email)}
        ${hiddenField('type', type)}
        ${hiddenField('token', token)}
        <button type="submit" style="background-color:#acdc9e; color:#3d081b; border:none; border-radius:6px; padding:14px 32px; font-size:16px; font-weight:700; cursor:pointer;">Unsubscribe me</button>
      </form>
    `
  );
}

/**
 * Testable core — see createCheckoutSession.js's handleCreateCheckoutSession
 * for why dependencies are passed as parameters.
 */
async function handleUnsubscribe(req, res, { db, secret, serverTimestamp, logger }) {
  // GET carries fields as query params (the emailed link); the
  // interstitial's POST carries the same fields as a form body.
  const source = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const { email, type, token } = source;

  // A repeated query param (e.g. ?email=a@example.com&email=b@example.com)
  // parses as an array, not a string. A single-element array stringifies
  // identically to its one element via template-literal coercion, so a
  // legitimately-issued token for a plain-string email still verifies
  // against the array form -- without the typeof checks here, that would
  // pass verification and then crash on email.toLowerCase() downstream.
  const isMissingOrNonString = (value) => typeof value !== 'string' || !value;
  if (isMissingOrNonString(email) || isMissingOrNonString(type) || isMissingOrNonString(token)) {
    return res.status(400).send(page(
      'Invalid Unsubscribe Link', '#e74c3c',
      '<p>This unsubscribe link is invalid or incomplete.</p>'
    ));
  }

  if (!verifyUnsubscribeToken(email, type, token, secret)) {
    return res.status(403).send(page(
      'Invalid Token', '#e74c3c',
      '<p>This unsubscribe link is invalid or has expired.</p>'
    ));
  }

  // The token is valid. GET stops here and renders the interstitial -- see
  // renderUnsubscribeInterstitial's comment for why the actual preference
  // update is gated behind a real POST.
  if (req.method !== 'POST') {
    return res.send(renderUnsubscribeInterstitial({ email, type, token }));
  }

  try {
    // Find the subscriber
    const subscribersRef = db.collection("newsletter_signups");
    const snapshot = await subscribersRef.where("email", "==", email.toLowerCase().trim()).get();

    if (snapshot.empty) {
      return res.status(404).send(page(
        'Email Not Found', '#f39c12',
        `<p>We couldn't find ${escapeHtml(email)} in our subscriber list.</p>`
      ));
    }

    const subscriberDoc = snapshot.docs[0];
    const currentPreferences = subscriberDoc.data().preferences || {};

    // Update preferences based on unsubscribe type
    let newPreferences = { ...currentPreferences };
    let unsubscribeMessage = "";

    switch (type) {
      case 'newsletter':
        newPreferences.newsletter = false;
        unsubscribeMessage = "You have been unsubscribed from newsletter emails.";
        break;
      case 'events':
        newPreferences.events = false;
        unsubscribeMessage = "You have been unsubscribed from event notifications.";
        break;
      case 'all':
        newPreferences = { newsletter: false, events: false, orders: true }; // Keep orders for legal reasons
        unsubscribeMessage = "You have been unsubscribed from all marketing emails.";
        break;
      default:
        return res.status(400).send("Invalid unsubscribe type");
    }

    // Update the subscriber's preferences
    await subscriberDoc.ref.update({
      preferences: newPreferences,
      unsubscribedAt: serverTimestamp(),
      unsubscribeType: type
    });

    // Never log the email itself (CL9 -- no PII in logs); the type alone
    // is enough to debug/monitor this endpoint.
    logger.info(`Unsubscribe: ${type} preference updated.`);

    // Return success page
    res.send(`
      <html>
        <head>
          <title>Unsubscribed - MyFriendRoze</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f9f9f9;">
          <div style="background: white; padding: 30px; border-radius: 8px; text-align: center;">
            <h2 style="color: #4CAF50;">✓ Unsubscribed Successfully</h2>
            <p style="font-size: 16px; color: #333;">${unsubscribeMessage}</p>
            <p style="color: #666; margin-top: 20px;">
              You will continue to receive order confirmations and shipping notifications for any purchases.
            </p>
            <div style="margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 5px;">
              <h3 style="color: #333; margin-top: 0;">Want to resubscribe later?</h3>
              <p style="color: #666;">Visit <a href="https://myfriendroze.com" style="color: #4CAF50;">myfriendroze.com</a> and sign up again.</p>
            </div>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    logger.error("Unsubscribe error:", error);
    res.status(500).send(page(
      'Error', '#e74c3c',
      '<p>Sorry, there was an error processing your unsubscribe request. Please try again later.</p>'
    ));
  }
}

// invoker: 'public' -- clicked directly from an email link, not proxied
// through the site. This project's domain-restricted-sharing org policy
// blocks anonymous Cloud Run invocation by default (same reasoning as
// newsletterSignup.js/confirmNewsletterSignup.js), so every unsubscribe
// link in the welcome email would 403 without this declared.
/* v8 ignore start -- thin wiring, same rationale as createCheckoutSession.js
   and orderConfirmation.js's wrappers. */
exports.unsubscribe = onRequest(
  { region: "us-west1", secrets: [unsubscribeSecret], invoker: "public" },
  async (req, res) => handleUnsubscribe(req, res, {
    db: admin.firestore(),
    secret: unsubscribeSecret.value(),
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    logger,
  })
);
/* v8 ignore stop */

// Exported separately for testing.
exports.handleUnsubscribe = handleUnsubscribe;
