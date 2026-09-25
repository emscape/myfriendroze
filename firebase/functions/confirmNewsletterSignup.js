const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const { verifyConfirmationToken, isConfirmationTokenExpired } = require("./lib/confirmationToken");
const { buildSignupRecord, buildExistingDocUpdate } = require("./lib/newsletter-signup");
const { generateUnsubscribeToken } = require("./lib/unsubscribeToken");
const { page } = require("./lib/htmlPage");
const { escapeHtml } = require("./lib/escapeHtml");

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
// Matches lib/newsletter-signup.js's CONFIRM_BASE_URL constant -- used here
// as the interstitial form's explicit POST target, so submission doesn't
// depend on how a browser resolves a relative/empty form action.
const CONFIRM_BASE_URL = "https://us-west1-myfriendroze-platform.cloudfunctions.net/confirmNewsletterSignup";

function buildUnsubscribeLinks(email, secret) {
  return {
    newsletter: `${UNSUBSCRIBE_BASE_URL}?email=${encodeURIComponent(email)}&type=newsletter&token=${generateUnsubscribeToken(email, 'newsletter', secret)}`,
    all: `${UNSUBSCRIBE_BASE_URL}?email=${encodeURIComponent(email)}&type=all&token=${generateUnsubscribeToken(email, 'all', secret)}`,
  };
}

// GET must stay side-effect-free (RFC 7231 "safe methods") -- email
// security scanners (Microsoft Safe Links, Proofpoint, Mimecast, etc.)
// routinely prefetch every link in an incoming email to scan it before a
// human ever clicks, which would otherwise silently "confirm" a
// subscription nobody consented to, defeating the entire point of double
// opt-in. GET renders this interstitial instead; only a real POST -- a
// hidden-field form a prefetcher won't submit -- performs the actual
// create-record-and-send-email side effect.
function renderConfirmInterstitial({ email, firstName, lastName, issuedAt, token }) {
  const hiddenField = (name, value) =>
    value === undefined ? '' : `<input type="hidden" name="${name}" value="${escapeHtml(String(value))}">`;

  return page(
    'Confirm your subscription 🌹', '#3d081b',
    `
      <p>Click below to confirm you'd like to receive the myfriendroze newsletter.</p>
      <form method="POST" action="${CONFIRM_BASE_URL}" style="margin-top:24px;">
        ${hiddenField('email', email)}
        ${hiddenField('firstName', firstName)}
        ${hiddenField('lastName', lastName)}
        ${hiddenField('issuedAt', issuedAt)}
        ${hiddenField('token', token)}
        <button type="submit" style="background-color:#acdc9e; color:#3d081b; border:none; border-radius:6px; padding:14px 32px; font-size:16px; font-weight:700; cursor:pointer;">Confirm my subscription</button>
      </form>
    `
  );
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
  // GET carries the fields as query params (the emailed link); the
  // interstitial's POST carries the same fields as a form body. Either
  // way, the same fields get validated identically below.
  const source = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const { email, firstName, lastName, issuedAt, token } = source;

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

  // The token is valid and unexpired. GET stops here and renders the
  // interstitial -- see renderConfirmInterstitial's comment for why the
  // actual side effect is gated behind a real POST.
  if (req.method !== 'POST') {
    return res.send(renderConfirmInterstitial({ email, firstName, lastName, issuedAt, token }));
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
        // A confirmation link must not be able to silently reverse a
        // *later* explicit unsubscribe. unsubscribe.js always records
        // unsubscribedAt on every opt-out (see its own handleUnsubscribe);
        // comparing the token's own mint time (issuedAt) against that
        // timestamp answers the question that actually matters -- was
        // this specific signup intent expressed before or after the
        // subscriber opted out -- regardless of how many confirmation
        // emails are outstanding or what order they're opened in.
        //
        // An earlier version of this check tracked only the most recent
        // token that had confirmed (a "high-water mark"), which missed a
        // real case Copilot review caught: a *newer*, never-yet-used
        // token minted *before* the unsubscribe is still newer than the
        // mark, so it would incorrectly pass. Comparing against the
        // actual unsubscribe event, rather than a proxy for it, closes
        // that gap regardless of token ordering.
        const unsubscribedAtMs =
          data.unsubscribedAt && typeof data.unsubscribedAt.toMillis === 'function'
            ? data.unsubscribedAt.toMillis()
            : null;
        // KNOWN, ACCEPTED RISK (same call the original newsletterSignup.js
        // made, restored here since this file's rewrite dropped the
        // explanation, not the decision): unsubscribe.js updates this same
        // doc non-transactionally. If that write commits between this
        // transaction's read and commit, Firestore retries this callback
        // against the now-unsubscribed doc, and this branch resubscribes
        // -- so an unsubscribe landing in that exact window could get
        // overwritten by an in-flight confirm. The window is a single
        // Firestore transaction retry (tens of milliseconds), and requires
        // the same email to be confirming *and* unsubscribing at
        // essentially the same instant -- not a realistic human-timescale
        // collision. Coordinating the two functions transactionally would
        // be a materially bigger cross-function change than this risk
        // warrants. Unlike when this was first written, unsubscribe.js is
        // now actually deployed (this PR wires it up for the first time),
        // so the risk is live rather than theoretical -- re-affirmed as
        // accepted rather than silently inherited.
        const tokenPredatesUnsubscribe =
          unsubscribedAtMs !== null && Number(issuedAt) <= unsubscribedAtMs;
        if (tokenPredatesUnsubscribe) {
          return { shouldSendEmail: false, action: "resubscribe-blocked-stale-token" };
        }
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

    if (action === "resubscribe-blocked-stale-token") {
      return res.send(page(
        "This link has already been used", '#f39c12',
        "<p>You confirmed this subscription once already, and have since unsubscribed. "
          + "If you'd like to resubscribe, please sign up again on the site for a fresh confirmation link.</p>"
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
