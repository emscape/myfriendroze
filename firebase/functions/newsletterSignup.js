const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const {
  buildConfirmUrl,
  validateNameLengths,
  evaluateRateLimit,
} = require("./lib/newsletter-signup");
const { generateConfirmationToken } = require("./lib/confirmationToken");

if (!admin.apps.length) {
  admin.initializeApp();
}

const brevoApiKey = defineSecret("BREVO_API_KEY");
const brevoTemplates = defineSecret("BREVO_TEMPLATES");
const newsletterConfirmSecret = defineSecret("NEWSLETTER_CONFIRM_SECRET");

function isValidEmail(email) {
  // This handler is directly publicly callable (invoker: 'public'), not
  // only reachable through the astro proxy's own validation -- typeof
  // must be checked here too, since RegExp.test() coerces its argument to
  // a string, so e.g. the single-element array ['a@b.com'] would
  // otherwise pass.
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === "string" && emailRegex.test(email);
}

/**
 * Testable core — see createCheckoutSession.js's handleCreateCheckoutSession
 * for why dependencies are passed as parameters. No newsletter_signups
 * subscriber record gets written here: this is double opt-in step 1,
 * sending only a confirmation email carrying a signed token.
 * confirmNewsletterSignup.js (step 2) is where that record actually gets
 * created, once the link is clicked. (checkRateLimit's real implementation,
 * in the v8-ignored wrapper below, does write to the separate
 * newsletter_signup_rate_limits collection -- unrelated to subscriber
 * data, and already noted in that wrapper's own comment.)
 */
async function handleNewsletterSignup(req, res, { checkRateLimit, sendConfirmationEmail, secret, now }) {
  if (req.method !== "POST") {
    logger.warn("Received non-POST request.");
    return res.status(405).send("Method Not Allowed");
  }

  const clientIp = req.ip || "unknown";
  const withinRateLimit = await checkRateLimit(clientIp);
  if (!withinRateLimit) {
    logger.warn("Newsletter signup rate limit exceeded.");
    return res.status(429).json({ error: "Too many requests. Please try again later." });
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

  const nameLengthCheck = validateNameLengths({ firstName, lastName });
  if (!nameLengthCheck.valid) {
    logger.error("Name too long.");
    return res.status(400).json({ error: nameLengthCheck.error });
  }

  // Normalized once, here, and used consistently for signing AND the
  // emailed URL below -- buildConfirmUrl trims before putting a name in
  // the query string, so signing the untrimmed value (e.g. "  Roze  ")
  // while the link carries the trimmed one ("Roze") would make
  // confirmNewsletterSignup.js recompute a different HMAC than what was
  // actually signed, permanently 403ing an entirely normal signup.
  const normalizedFirstName = typeof firstName === 'string' ? firstName.trim() : firstName;
  const normalizedLastName = typeof lastName === 'string' ? lastName.trim() : lastName;

  const issuedAt = now();
  const token = generateConfirmationToken(
    { email, firstName: normalizedFirstName, lastName: normalizedLastName, issuedAt },
    secret
  );
  const confirmUrl = buildConfirmUrl({
    email, firstName: normalizedFirstName, lastName: normalizedLastName, issuedAt, token,
  });

  try {
    await sendConfirmationEmail({ email, firstName: normalizedFirstName, confirmUrl });
  } catch (error) {
    logger.error("Newsletter signup error:", error);
    return res.status(500).json({ error: "Failed to sign up." });
  }

  logger.info("Newsletter signup: confirmation email sent.");
  return res.status(200).json({
    success: true,
    message: "Almost done! Check your email to confirm your subscription.",
  });
}

/* v8 ignore start -- thin wiring, same rationale as createCheckoutSession.js
   and orderConfirmation.js's wrappers. checkRateLimit lives here (not in
   the testable core) for the same reason: every handleNewsletterSignup
   test injects its own fake, so the real Firestore-backed implementation
   is only ever exercised by real traffic, never by this suite -- exactly
   the "always-present-but-never-exercised" shape that dilutes coverage
   when left outside an ignored block. */

// Generous on purpose: this only needs to stop a burst of automated abuse
// (this function is invoker: 'public', reachable directly by anyone who
// bypasses the astro proxy), not throttle legitimate traffic through the
// real site. IMPORTANT CAVEAT: req.ip below is GFE's own determination of
// the connecting client, which is correct and meaningful for a *direct*
// call (the abuse case this actually guards against) -- but a call
// proxied through ssrAstro (the legitimate site path) shows ssrAstro's own
// Cloud Run egress identity, not the original browser's IP, since
// astro/src/pages/api/newsletter.js doesn't forward the original client IP
// today. Real distinct site visitors could therefore theoretically share a
// bucket; the threshold is set high enough that normal traffic for this
// site shouldn't realistically hit it.
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

async function checkRateLimit(ip) {
  const rateLimitRef = admin.firestore().collection("newsletter_signup_rate_limits").doc(ip);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(rateLimitRef);
    const { allowed, newState } = evaluateRateLimit(snap.exists ? snap.data() : null, Date.now(), {
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    // expiresAt marks this doc for automatic deletion via a Firestore TTL
    // policy -- REQUIRES A ONE-TIME MANUAL STEP: configure a Firestore TTL
    // policy on newsletter_signup_rate_limits.expiresAt (Console: Firestore
    // -> TTL tab -> Create policy) -- the field alone does nothing without
    // that policy.
    tx.set(rateLimitRef, {
      ...newState,
      expiresAt: admin.firestore.Timestamp.fromMillis(newState.windowStart + RATE_LIMIT_WINDOW_MS),
    });
    return allowed;
  });
}

// invoker: 'public' matches ssrAstro.js -- this project's domain-restricted-
// sharing org policy blocks anonymous Cloud Run invocation by default, so a
// function meant to be called by the public site needs this declared or
// every call 403s regardless of how correct the request handling is.
// region: 'us-west1' matches astro/src/lib/newsletter-signup-url.js's
// hardcoded target region -- Functions v2 defaults to us-central1 when
// unspecified, which would silently 404 every real call in production.
exports.newsletterSignup = onRequest(
  { region: "us-west1", secrets: [brevoApiKey, brevoTemplates, newsletterConfirmSecret], invoker: "public" },
  async (req, res) => {
    const { sendBrevoEmail } = require("./lib/sendBrevoEmail");
    const { newsletterConfirmationEmailParams } = require("./lib/emailPayload");

    const apiKey = brevoApiKey.value();
    const templates = JSON.parse(brevoTemplates.value());
    const sender = JSON.parse(
      process.env.EMAIL_NEWSLETTER || '{"email":"newsletter@myfriendroze.com","name":"MyFriendRoze Newsletter"}'
    );

    return handleNewsletterSignup(req, res, {
      checkRateLimit,
      secret: newsletterConfirmSecret.value(),
      now: () => Date.now(),
      sendConfirmationEmail: ({ email, firstName, confirmUrl }) =>
        sendBrevoEmail({
          apiKey,
          payload: {
            sender,
            to: [{ email }],
            templateId: templates.newsletterConfirmation,
            params: newsletterConfirmationEmailParams({ email, firstName, confirmUrl }),
          },
        }),
    });
  }
);
/* v8 ignore stop */

// Exported separately for testing.
exports.handleNewsletterSignup = handleNewsletterSignup;
