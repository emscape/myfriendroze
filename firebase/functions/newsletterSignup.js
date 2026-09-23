
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const logger = require("firebase-functions/logger");
const { buildSignupRecord, buildWelcomeEmailHtml } = require("./lib/newsletter-signup");

if (!admin.apps.length) {
  admin.initializeApp();
}

// BREVO_API_KEY is Secret Manager-backed (same as stripeWebhook.js,
// orderConfirmation.js, eventNotification.js, orderShipped.js) — it used
// to be read as a plain process.env value here, which required a
// plaintext BREVO_API_KEY line in firebase/functions/.env. Firebase loads
// .env into every function in the codebase, so that plain declaration
// collided with this same variable name being declared as a secret
// elsewhere, and Cloud Run refused to deploy any function that declared
// both. BREVO_SENDER/BREVO_TEMPLATE_ID aren't secrets anywhere else in
// this codebase, so they're untouched.
const brevoApiKey = defineSecret("BREVO_API_KEY");
const BREVO_SENDER = process.env.BREVO_SENDER;
const BREVO_TEMPLATE_ID = process.env.BREVO_TEMPLATE_ID;

// invoker: 'public' matches ssrAstro.js/stripeWebhook.js/
// createCheckoutSession.js -- this project's domain-restricted-sharing org
// policy blocks anonymous Cloud Run invocation by default (see
// astro-ssr-stripe-golive-session memory), so a function meant to be
// called by the public site needs this declared explicitly or every call
// 403s regardless of how correct the request/response handling is.
// region: 'us-west1' matches astro/src/lib/newsletter-signup-url.js's
// hardcoded target region -- Functions v2 defaults to us-central1 when
// unspecified, which would silently 404 every real call in production
// despite everything else being correct (caught in review, not by any
// test, since the proxy's tests only check the URL string it builds, not
// where the function actually deploys to).
exports.newsletterSignup = onRequest(
  { region: "us-west1", secrets: [brevoApiKey], invoker: "public" },
  async (req, res) => {
  // A secret's value is only resolved per-invocation, not at module load,
  // so this can't be hoisted to module scope the way the old
  // process.env read was.
  const BREVO_API_KEY = brevoApiKey.value();
  logger.info("Newsletter signup function triggered.");

  // Log environment variable status
  logger.debug(`BREVO_API_KEY set: ${!!BREVO_API_KEY}`);
  logger.debug(`BREVO_SENDER set: ${!!BREVO_SENDER}`);
  logger.debug(`BREVO_TEMPLATE_ID set: ${!!BREVO_TEMPLATE_ID}`);

  if (req.method !== "POST") {
    logger.warn("Received non-POST request.");
    return res.status(405).send("Method Not Allowed");
  }

  // `|| {}` guards a null/omitted body -- a client can send a JSON `null`
  // body (or none at all) and reach this line before the try block below,
  // where destructuring a null req.body would throw and surface as a 500
  // instead of the intended 400. Same pattern as createCheckoutSession.js.
  const { email, firstName, lastName } = req.body || {};
  if (!email || !isValidEmail(email)) {
    logger.error("Invalid email address provided.");
    return res.status(400).json({ error: "Valid email address required." });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    // Keying the doc on the normalized email (instead of add()'s random
    // ID) plus a transaction makes the existence check and the write
    // atomic -- a plain query-then-add has a race where two concurrent
    // submissions can both observe "no existing doc" and both proceed,
    // each sending its own welcome email. welcomeEmailSentAt separately
    // distinguishes "a doc exists" from "the email was actually
    // delivered": a prior attempt that created the doc but then failed to
    // reach Brevo (network error, Brevo API error) would otherwise be
    // treated as fully complete on every retry, permanently. A prior
    // unsubscribe (preferences.newsletter === false, set by
    // unsubscribe.js) is treated as a resubscribe rather than a silent
    // no-op -- otherwise someone who explicitly re-signs-up after
    // unsubscribing would stay unsubscribed with no error shown to them.
    const docRef = admin.firestore().collection("newsletter_signups").doc(normalizedEmail);
    const { shouldSendEmail, action } = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        tx.set(docRef, {
          ...buildSignupRecord({ email, firstName, lastName }),
          welcomeEmailSentAt: null,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { shouldSendEmail: true, action: "created" };
      }
      const data = snap.data();
      const wasUnsubscribed = data.preferences && data.preferences.newsletter === false;
      if (wasUnsubscribed) {
        tx.update(docRef, { "preferences.newsletter": true });
        return { shouldSendEmail: true, action: "resubscribed" };
      }
      return {
        shouldSendEmail: !data.welcomeEmailSentAt,
        action: data.welcomeEmailSentAt ? "already-delivered" : "retry-delivery",
      };
    });

    // Never log the email/name themselves (CL9 -- no PII in logs); the
    // transaction outcome alone is enough to debug/monitor this endpoint.
    logger.info(`Newsletter signup: ${action}.`);

    if (!shouldSendEmail) {
      return res.status(200).json({ success: true, message: "Signed up successfully!" });
    }

    if (BREVO_API_KEY && BREVO_SENDER) {
      const brevoPayload = {
        sender: JSON.parse(BREVO_SENDER),
        to: [{ email: email }],
        subject: "Welcome to MyFriendRoze Newsletter!",
        htmlContent: buildWelcomeEmailHtml({ firstName }),
      };
      if (BREVO_TEMPLATE_ID) {
        brevoPayload.templateId = Number(BREVO_TEMPLATE_ID);
      }
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(brevoPayload),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`Brevo API error: ${response.statusText}`, { errorBody });
        throw new Error(`Brevo API request failed with status ${response.status}`);
      }
      await docRef.update({ welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp() });
      logger.info("Successfully sent welcome email via Brevo.");
    } else {
      logger.warn("Brevo API key or sender not configured. Skipping email.");
    }

    return res.status(200).json({ success: true, message: "Signed up successfully!" });
  } catch (error) {
    logger.error("Newsletter signup error:", error);
    return res.status(500).json({ error: "Failed to sign up." });
  }
});

function isValidEmail(email) {
  // This function is directly publicly callable (invoker: 'public'), not
  // only reachable through the astro proxy's own validation -- typeof
  // must be checked here too, since RegExp.test() coerces its argument to
  // a string, so e.g. the single-element array ['a@b.com'] would
  // otherwise pass, then throw downstream where buildSignupRecord calls
  // .toLowerCase() on the array itself.
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === "string" && emailRegex.test(email);
}
