const { onRequest, onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}

// Generate unsubscribe token
function generateUnsubscribeToken(email, type) {
  const secret = process.env.UNSUBSCRIBE_SECRET || 'default-secret-change-me';
  return crypto.createHmac('sha256', secret)
    .update(`${email}:${type}`)
    .digest('hex');
}

// Verify unsubscribe token
function verifyUnsubscribeToken(email, type, token) {
  const expectedToken = generateUnsubscribeToken(email, type);
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
}

// Generate unsubscribe URLs
exports.generateUnsubscribeUrls = onCall({
  region: "us-west1"
}, async (request) => {
  const { email } = request.data;
  
  if (!email) {
    throw new Error("Email is required");
  }

  const baseUrl = "https://us-west1-myfriendroze-platform.cloudfunctions.net/unsubscribe";
  
  return {
    newsletter: `${baseUrl}?email=${encodeURIComponent(email)}&type=newsletter&token=${generateUnsubscribeToken(email, 'newsletter')}`,
    events: `${baseUrl}?email=${encodeURIComponent(email)}&type=events&token=${generateUnsubscribeToken(email, 'events')}`,
    all: `${baseUrl}?email=${encodeURIComponent(email)}&type=all&token=${generateUnsubscribeToken(email, 'all')}`
  };
});

// Handle unsubscribe requests
exports.unsubscribe = onRequest({
  region: "us-west1"
}, async (req, res) => {
  const { email, type, token } = req.query;

  if (!email || !type || !token) {
    return res.status(400).send(`
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h2 style="color: #e74c3c;">Invalid Unsubscribe Link</h2>
          <p>This unsubscribe link is invalid or incomplete.</p>
        </body>
      </html>
    `);
  }

  // Verify token
  if (!verifyUnsubscribeToken(email, type, token)) {
    return res.status(403).send(`
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h2 style="color: #e74c3c;">Invalid Token</h2>
          <p>This unsubscribe link is invalid or has expired.</p>
        </body>
      </html>
    `);
  }

  try {
    // Find the subscriber
    const subscribersRef = admin.firestore().collection("newsletter_signups");
    const snapshot = await subscribersRef.where("email", "==", email.toLowerCase().trim()).get();

    if (snapshot.empty) {
      return res.status(404).send(`
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h2 style="color: #f39c12;">Email Not Found</h2>
            <p>We couldn't find ${email} in our subscriber list.</p>
          </body>
        </html>
      `);
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
      unsubscribedAt: admin.firestore.FieldValue.serverTimestamp(),
      unsubscribeType: type
    });

    logger.info(`Unsubscribed ${email} from ${type}`);

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
    res.status(500).send(`
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h2 style="color: #e74c3c;">Error</h2>
          <p>Sorry, there was an error processing your unsubscribe request. Please try again later.</p>
        </body>
      </html>
    `);
  }
});
