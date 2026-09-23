
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const {
  buildSignupRecord,
  buildWelcomeEmailHtml,
  buildExistingDocUpdate,
  validateNameLengths,
} = require("./lib/newsletter-signup");

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

  const nameLengthCheck = validateNameLengths({ firstName, lastName });
  if (!nameLengthCheck.valid) {
    logger.error("Name too long.");
    return res.status(400).json({ error: nameLengthCheck.error });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const signupsCollection = admin.firestore().collection("newsletter_signups");

    // Firestore document IDs can't contain "/" (it's a path separator) --
    // the local part of an email address legally can (e.g. "a/b@x.com"),
    // which would otherwise make doc() throw and turn a valid signup into
    // a 500. A hash of the normalized email is always Firestore-safe and
    // still fully deterministic per email, which is what the atomicity
    // fix below actually needs.
    const emailHash = crypto.createHash("sha256").update(normalizedEmail).digest("hex");

    // Before this fix, newsletterSignup wrote via .add() with a random
    // ID, so pre-existing subscribers' docs aren't at this deterministic
    // ID at all. Looking up only the hashed-ID doc would miss them
    // entirely, creating a duplicate record (and a duplicate email) on
    // any repeat signup, and unsubscribe.js's own first-match query would
    // keep updating their original legacy doc while this one drifts.
    // Finding any pre-existing doc by the email field first, and
    // operating on THAT doc's ref when one exists, keeps every code path
    // (this function and unsubscribe.js) pointed at the same record.
    const legacyMatch = await signupsCollection
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();
    const docRef = !legacyMatch.empty
      ? legacyMatch.docs[0].ref
      : signupsCollection.doc(emailHash);

    // Keying the write on a single doc ref inside a transaction makes the
    // existence check and the write atomic -- a plain query-then-add has
    // a race where two concurrent submissions can both observe "no
    // existing doc" and both proceed, each sending its own welcome email.
    // welcomeEmailSentAt is claimed *inside this same transaction*, at
    // decision time, rather than after Brevo succeeds -- claiming it only
    // after a successful send would leave a window where a concurrent
    // duplicate request's transaction retry still observes null and also
    // decides to send. Firestore transactions are serializable, so the
    // loser of that retry always sees the winner's already-committed
    // claim. If Brevo then actually fails, the claim is rolled back
    // below so a legitimate retry can still go through -- otherwise a
    // prior attempt that created the doc but never reached Brevo would be
    // treated as fully complete forever. A prior unsubscribe
    // (preferences.newsletter === false, set by unsubscribe.js) is
    // treated as a resubscribe rather than a silent no-op -- otherwise
    // someone who explicitly re-signs-up after unsubscribing would stay
    // unsubscribed with no error shown to them.
    const { shouldSendEmail, action } = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        tx.set(docRef, {
          ...buildSignupRecord({ email, firstName, lastName }),
          welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { shouldSendEmail: true, action: "created" };
      }
      const data = snap.data();
      const wasUnsubscribed = data.preferences && data.preferences.newsletter === false;
      if (wasUnsubscribed) {
        // buildExistingDocUpdate merges the existing preferences map
        // (rather than replacing it wholesale) and the current
        // firstName/lastName -- a legacy doc (pre-existing this fix) may
        // have no preferences field at all, and unsubscribe.js's "all"
        // type sets preferences.orders: true deliberately (legal/
        // record-keeping), which a full-object replace would silently
        // drop.
        tx.update(docRef, {
          ...buildExistingDocUpdate(data, { email, firstName, lastName }),
          welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { shouldSendEmail: true, action: "resubscribed" };
      }
      // Distinguishes "the field is absent" from "the field is explicitly
      // null" -- the pre-this-fix code never wrote welcomeEmailSentAt at
      // all, so every legacy doc has it absent, not null. Treating absent
      // the same as an explicit null (the rollback path actually writes
      // below) would mean the very first time any pre-existing subscriber
      // touches this code path, they'd be treated as never-delivered and
      // get a fresh welcome email blasted to them -- even though we have
      // no idea whether they already received one under the old code.
      // Only an explicit null (this same mechanism claimed a send and
      // then genuinely rolled it back after failing) is safe to retry.
      const hasDeliveryState = Object.prototype.hasOwnProperty.call(data, "welcomeEmailSentAt");
      if (hasDeliveryState && !data.welcomeEmailSentAt) {
        tx.update(docRef, {
          ...buildExistingDocUpdate(data, { email, firstName, lastName }),
          welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { shouldSendEmail: true, action: "retry-delivery" };
      }
      if (!hasDeliveryState) {
        // Legacy doc predating this tracking field entirely -- backfill it
        // (so future lookups have a real answer) without sending, rather
        // than risk re-emailing an existing subscriber on a technicality
        // of when their record happened to be created.
        tx.update(docRef, {
          ...buildExistingDocUpdate(data, { email, firstName, lastName }),
          welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { shouldSendEmail: false, action: "legacy-backfilled" };
      }
      return { shouldSendEmail: false, action: "already-delivered" };
    });

    // Never log the email/name themselves (CL9 -- no PII in logs); the
    // transaction outcome alone is enough to debug/monitor this endpoint.
    logger.info(`Newsletter signup: ${action}.`);

    if (!shouldSendEmail) {
      return res.status(200).json({ success: true, message: "Signed up successfully!" });
    }

    if (BREVO_API_KEY && BREVO_SENDER) {
      // Payload construction (including JSON.parse(BREVO_SENDER), which
      // throws on a malformed sender setting) is inside this same
      // try/catch specifically so any failure before or during the
      // network call rolls back the claim -- a throw before entering the
      // try would otherwise skip the rollback and permanently strand the
      // doc as "already-delivered" despite no email ever having sent.
      try {
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
        logger.info("Successfully sent welcome email via Brevo.");
      } catch (brevoError) {
        // Roll back the optimistic claim made above so a genuine retry
        // (not a concurrent duplicate, which never reaches this point)
        // can still send the email instead of being treated as delivered.
        await docRef.update({ welcomeEmailSentAt: null });
        throw brevoError;
      }
    } else {
      // Same rollback as the catch block above -- config being absent
      // (e.g. local/dev) means no email was actually sent either, so the
      // claim must not stick. Otherwise, once BREVO_API_KEY/BREVO_SENDER
      // are eventually configured, a retry would see "already-delivered"
      // and this signup would never actually get its welcome email.
      await docRef.update({ welcomeEmailSentAt: null });
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
