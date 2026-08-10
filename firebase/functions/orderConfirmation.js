const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const functions = require("firebase-functions");

// Define secrets
const brevoApiKey = defineSecret("BREVO_API_KEY");
const brevoTemplates = defineSecret("BREVO_TEMPLATES");

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.sendOrderConfirmation = onCall({
  region: "us-west1",
  secrets: [brevoApiKey, brevoTemplates]
}, async (request) => {
  logger.info("Order confirmation function triggered.");

  // Get secret values and config
  const apiKey = brevoApiKey.value();
  const templates = JSON.parse(brevoTemplates.value());
  const ordersSender = JSON.parse(process.env.EMAIL_ORDERS || functions.config().email?.orders || '{"email":"orders@myfriendroze.com","name":"MyFriendRoze Orders"}');

  const { email, orderDetails } = request.data;

  if (!email || !orderDetails) {
    logger.error("Missing required fields: email or orderDetails");
    throw new Error("Email and order details are required");
  }

  if (!isValidEmail(email)) {
    logger.error("Invalid email address provided.");
    throw new Error("Valid email address required");
  }

  try {
    // Save order to Firestore
    const orderRef = await admin.firestore().collection("orders").add({
      email: email.toLowerCase().trim(),
      orderDetails: orderDetails,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: "confirmed"
    });
    
    logger.info(`Successfully saved order ${orderRef.id} to Firestore.`);

    // Send confirmation email
    if (apiKey && ordersSender) {
      const brevoPayload = {
        sender: ordersSender,
        to: [{ email: email }],
        templateId: templates.orderConfirmation,
        params: {
          EMAIL: email,
          ORDER_NUMBER: orderDetails.orderNumber || 'N/A',
          ORDER_TOTAL: orderDetails.total || 'N/A',
          CUSTOMER_NAME: orderDetails.customerName || '',
          ITEMS: orderDetails.items || [],
          SHIPPING_ADDRESS: orderDetails.shippingAddress || '',
          ESTIMATED_DELIVERY: orderDetails.estimatedDelivery || ''
        }
      };

      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(brevoPayload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`Brevo API error: ${response.statusText}`, { errorBody });
        throw new Error(`Failed to send confirmation email: ${response.status}`);
      }

      logger.info(`Successfully sent order confirmation email to ${email}`);
    } else {
      logger.warn("Brevo API key or orders sender not configured. Skipping email.");
    }

    return {
      success: true,
      message: "Order confirmed and email sent!",
      orderId: orderRef.id
    };

  } catch (error) {
    logger.error("Order confirmation error:", error);
    throw new Error("Failed to process order confirmation");
  }
});

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
