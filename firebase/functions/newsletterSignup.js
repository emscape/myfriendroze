
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
    // Idempotency: Firestore doesn't enforce uniqueness on its own, and
    // unsubscribe.js only ever updates the *first* matching document for a
    // given email -- without this check, a resubmitted signup (double
    // click, retry) would create a duplicate newsletter_signups doc and
    // send a second welcome email, and a resubscribe after unsubscribing
    // would leave stray duplicate docs unsubscribe.js can't fully clean up.
    // Same query pattern unsubscribe.js already uses against this
    // collection. Treated as a silent success (not an error) -- a repeat
    // signup attempt isn't a mistake worth surfacing to the visitor.
    const existing = await admin
      .firestore()
      .collection("newsletter_signups")
      .where("email", "==", normalizedEmail)
      .get();

    if (!existing.empty) {
      logger.info(`${normalizedEmail} is already subscribed -- skipping duplicate signup/email.`);
      return res.status(200).json({ success: true, message: "Signed up successfully!" });
    }

    await admin.firestore().collection("newsletter_signups").add({
      ...buildSignupRecord({ email, firstName, lastName }),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info(`Successfully added ${email} to Firestore.`);

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
      logger.info(`Successfully sent welcome email to ${email} via Brevo.`);
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
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
