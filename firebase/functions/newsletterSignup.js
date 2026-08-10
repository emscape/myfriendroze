
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const logger = require("firebase-functions/logger");

if (!admin.apps.length) {
  admin.initializeApp();
}

// Brevo API config
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER = process.env.BREVO_SENDER;
const BREVO_TEMPLATE_ID = process.env.BREVO_TEMPLATE_ID;

exports.newsletterSignup = onRequest(async (req, res) => {
  logger.info("Newsletter signup function triggered.");

  // Log environment variable status
  logger.debug(`BREVO_API_KEY set: ${!!BREVO_API_KEY}`);
  logger.debug(`BREVO_SENDER set: ${!!BREVO_SENDER}`);
  logger.debug(`BREVO_TEMPLATE_ID set: ${!!BREVO_TEMPLATE_ID}`);

  if (req.method !== "POST") {
    logger.warn("Received non-POST request.");
    return res.status(405).send("Method Not Allowed");
  }

  const { email } = req.body;
  if (!email || !isValidEmail(email)) {
    logger.error("Invalid email address provided.");
    return res.status(400).json({ error: "Valid email address required." });
  }

  try {
    await admin.firestore().collection("newsletter_signups").add({
      email: email.toLowerCase().trim(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info(`Successfully added ${email} to Firestore.`);

    if (BREVO_API_KEY && BREVO_SENDER) {
      const brevoPayload = {
        sender: JSON.parse(BREVO_SENDER),
        to: [{ email: email }],
        subject: "Welcome to MyFriendRoze Newsletter!",
        htmlContent: `
          <div style="font-family: Arial, sans-serif; background: #f9f9f9; padding: 32px;">
            <h2 style="color: #4CAF50;">Welcome to MyFriendRoze!</h2>
            <p>Hi there,</p>
            <p>Thank you for signing up for our newsletter. We're excited to have you join our community of plant lovers and creative souls!</p>
            <ul>
              <li>🌱 Get exclusive updates and offers</li>
              <li>🌸 Be the first to know about new products and events</li>
              <li>💌 Tips, inspiration, and more delivered to your inbox</li>
            </ul>
            <p>If you have any questions, just reply to this email—we love hearing from you!</p>
            <p style="margin-top:32px; color:#888; font-size:12px;">You are receiving this email because you signed up at myfriendroze.com.</p>
          </div>
        `,
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
