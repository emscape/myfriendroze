const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const { verifyConfirmationToken, isConfirmationTokenExpired } = require("./lib/confirmationToken");
const { buildSignupRecord, buildExistingDocUpdate } = require("./lib/newsletter-signup");
const { generateUnsubscribeToken } = require("./lib/unsubscribeToken");
const { page } = require("./lib/htmlPage");

if (!admin.apps.length) {
  admin.initializeApp();
}

const brevoApiKey = defineSecret("BREVO_API_KEY");
const brevoTemplates = defineSecret("BREVO_TEMPLATES");
const newsletterConfirmSecret = defineSecret("NEWSLETTER_CONFIRM_SECRET");
const unsubscribeSecret = defineSecret("UNSUBSCRIBE_SECRET");

const MAX_TOKEN_AGE_MS = 48 * 60 * 60 * 1000;

// Matches eventNotification.js's UNSUBSCRIBE_BASE_URL constant.
const UNSUBSCRIBE_BASE_URL = "https://us-west1-myfriendroze-platform.cloudfunctions.net/unsubscribe";

function buildUnsubscribeLinks(email, secret) {
  return {
    newsletter: `${UNSUBSCRIBE_BASE_URL}?email=${encodeURIComponent(email)}&type=newsletter&token=${generateUnsubscribeToken(email, 'newsletter', secret)}`,
    all: `${UNSUBSCRIBE_BASE_URL}?email=${encodeURIComponent(email)}&type=all&token=${generateUnsubscribeToken(email, 'all', secret)}`,
  };
}

const isMissingOrNonString = (value) => typeof value !== 'string' || !value;

/**
 * Testable core — see createCheckoutSession.js's handleCreateCheckoutSession
 * for why dependencies are passed as parameters. This is double opt-in
 * step 2: the Firestore create/resubscribe/retry-delivery logic relocated
 * unchanged from the old newsletterSignup.js, now gated on a verified,
 * unexpired confirmation token instead of a raw POST.
 */
async function handleConfirmNewsletterSignup(req, res, {
  db, secret, unsubscribeSecret: unsubSecret, now, sendWelcomeEmail, serverTimestamp,
}) {
  const { email, firstName, lastName, issuedAt, token } = req.query;

  // A repeated query param parses as an array, not a string -- same class
  // of bug fixed in unsubscribe.js this morning (see its handleUnsubscribe
  // for the full reasoning: a single-element array can stringify
  // identically to its one element via template-literal coercion, letting
  // a legitimately-issued token verify against a malformed shape).
  if (
    isMissingOrNonString(email) || isMissingOrNonString(issuedAt) || isMissingOrNonString(token)
    || (firstName !== undefined && typeof firstName !== 'string')
    || (lastName !== undefined && typeof lastName !== 'string')
  ) {
    return res.status(400).send(page(
      'Invalid Confirmation Link', '#e74c3c',
      '<p>This confirmation link is invalid or incomplete.</p>'
    ));
  }

  if (!verifyConfirmationToken({ email, firstName, lastName, issuedAt, token }, secret)) {
    return res.status(403).send(page(
      'Invalid Link', '#e74c3c',
      '<p>This confirmation link is invalid.</p>'
    ));
  }

  if (isConfirmationTokenExpired(issuedAt, now(), MAX_TOKEN_AGE_MS)) {
    return res.status(403).send(page(
      'Link Expired', '#e74c3c',
      '<p>This confirmation link has expired. Please sign up again to get a new one.</p>'
    ));
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const signupsCollection = db.collection("newsletter_signups");

    // Firestore document IDs can't contain "/" -- a hash of the normalized
    // email is always Firestore-safe and deterministic. Finding any
    // pre-existing doc by the email field first (rather than only the
    // hashed-ID doc) keeps this and unsubscribe.js pointed at the same
    // record for subscribers who predate this deterministic-ID scheme.
    const emailHash = crypto.createHash("sha256").update(normalizedEmail).digest("hex");
    const legacyMatch = await signupsCollection.where("email", "==", normalizedEmail).limit(1).get();
    const docRef = !legacyMatch.empty ? legacyMatch.docs[0].ref : signupsCollection.doc(emailHash);

    // Same atomicity reasoning as the old newsletterSignup.js: the
    // existence check and the write happen inside one transaction, and
    // welcomeEmailSentAt is claimed at decision time (not after Brevo
    // succeeds) so a concurrent duplicate click can't also decide to send.
    // Rolled back below if the send then actually fails.
    const { shouldSendEmail, action } = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        tx.set(docRef, {
          ...buildSignupRecord({ email, firstName, lastName }),
          welcomeEmailSentAt: serverTimestamp(),
          timestamp: serverTimestamp(),
        });
        return { shouldSendEmail: true, action: "created" };
      }
      const data = snap.data();
      const wasUnsubscribed = data.preferences && data.preferences.newsletter === false;
      if (wasUnsubscribed) {
        tx.update(docRef, {
          ...buildExistingDocUpdate(data, { email, firstName, lastName }),
          welcomeEmailSentAt: serverTimestamp(),
        });
        return { shouldSendEmail: true, action: "resubscribed" };
      }
      const hasDeliveryState = Object.prototype.hasOwnProperty.call(data, "welcomeEmailSentAt");
      if (hasDeliveryState && !data.welcomeEmailSentAt) {
        tx.update(docRef, {
          ...buildExistingDocUpdate(data, { email, firstName, lastName }),
          welcomeEmailSentAt: serverTimestamp(),
        });
        return { shouldSendEmail: true, action: "retry-delivery" };
      }
      if (!hasDeliveryState) {
        tx.update(docRef, {
          ...buildExistingDocUpdate(data, { email, firstName, lastName }),
          welcomeEmailSentAt: serverTimestamp(),
        });
        return { shouldSendEmail: false, action: "legacy-backfilled" };
      }
      const hasNewName =
        (typeof firstName === "string" && firstName.trim()) ||
        (typeof lastName === "string" && lastName.trim());
      if (hasNewName) {
        tx.update(docRef, buildExistingDocUpdate(data, { email, firstName, lastName }));
      }
      return { shouldSendEmail: false, action: "already-delivered" };
    });

    // Never log the email/name themselves (CL9 -- no PII in logs); the
    // transaction outcome alone is enough to debug/monitor this endpoint.
    logger.info(`Newsletter confirm: ${action}.`);

    if (shouldSendEmail) {
      try {
        const { newsletter: unsubscribeNewsletter, all: unsubscribeAll } = buildUnsubscribeLinks(email, unsubSecret);
        await sendWelcomeEmail({ email, firstName, unsubscribeNewsletter, unsubscribeAll });
      } catch (error) {
        // Roll back the optimistic claim so a genuine retry (re-clicking
        // the still-valid link) can still send, instead of being treated
        // as already delivered.
        await docRef.update({ welcomeEmailSentAt: null });
        throw error;
      }
      return res.send(page(
        "You're confirmed! 🌱", '#4CAF50',
        '<p>Welcome to MyFriendRoze! Check your inbox for a welcome email.</p>'
      ));
    }

    return res.send(page(
      "You're all set! 🌱", '#4CAF50',
      '<p>This subscription is already confirmed — no further action needed.</p>'
    ));
  } catch (error) {
    logger.error("Newsletter confirmation error:", error);
    return res.status(500).send(page(
      'Error', '#e74c3c',
      '<p>Sorry, there was an error confirming your subscription. Please try again later.</p>'
    ));
  }
}

// invoker: 'public' declared explicitly in code -- clicked directly from an
// email link, not proxied through the site. Same org-policy reasoning as
// newsletterSignup.js. No IP rate limit: forging a valid signed token is
// the actual barrier here, not request volume (same precedent as
// unsubscribe.js, which also has none).
/* v8 ignore start -- thin wiring, same rationale as createCheckoutSession.js
   and orderConfirmation.js's wrappers. */
exports.confirmNewsletterSignup = onRequest(
  { region: "us-west1", secrets: [brevoApiKey, brevoTemplates, newsletterConfirmSecret, unsubscribeSecret], invoker: "public" },
  async (req, res) => {
    const { sendBrevoEmail } = require("./lib/sendBrevoEmail");
    const { newsletterWelcomeEmailParams } = require("./lib/emailPayload");

    const apiKey = brevoApiKey.value();
    const templates = JSON.parse(brevoTemplates.value());
    const sender = JSON.parse(
      process.env.EMAIL_NEWSLETTER || '{"email":"newsletter@myfriendroze.com","name":"MyFriendRoze Newsletter"}'
    );

    return handleConfirmNewsletterSignup(req, res, {
      db: admin.firestore(),
      secret: newsletterConfirmSecret.value(),
      unsubscribeSecret: unsubscribeSecret.value(),
      now: () => Date.now(),
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      sendWelcomeEmail: ({ email, firstName, unsubscribeNewsletter, unsubscribeAll }) =>
        sendBrevoEmail({
          apiKey,
          payload: {
            sender,
            to: [{ email }],
            templateId: templates.newsletterWelcome,
            params: newsletterWelcomeEmailParams({ email, firstName, unsubscribeNewsletter, unsubscribeAll }),
          },
        }),
    });
  }
);
/* v8 ignore stop */

// Exported separately for testing.
exports.handleConfirmNewsletterSignup = handleConfirmNewsletterSignup;
