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

exports.sendOrderShippedNotification = onCall({
  region: "us-west1",
  secrets: [brevoApiKey, brevoTemplates]
}, async (request) => {
  logger.info("Order shipped notification function triggered.");

  // Get secret values and config
  const apiKey = brevoApiKey.value();
  const templates = JSON.parse(brevoTemplates.value());
  const ordersSender = JSON.parse(process.env.EMAIL_ORDERS || functions.config().email?.orders || '{"email":"orders@myfriendroze.com","name":"MyFriendRoze Orders"}');

  const { email, orderDetails, shippingDetails } = request.data;

  if (!email || !orderDetails || !shippingDetails) {
    logger.error("Missing required fields: email, orderDetails, or shippingDetails");
    throw new Error("Email, order details, and shipping details are required");
  }

  if (!isValidEmail(email)) {
    logger.error("Invalid email address provided.");
    throw new Error("Valid email address required");
  }

  try {
    // Update order status in Firestore
    const ordersRef = admin.firestore().collection("orders");
    const orderQuery = await ordersRef.where("email", "==", email.toLowerCase().trim())
                                     .where("orderDetails.orderNumber", "==", orderDetails.orderNumber)
                                     .get();

    if (!orderQuery.empty) {
      const orderDoc = orderQuery.docs[0];
      await orderDoc.ref.update({
        status: "shipped",
        shippingDetails: shippingDetails,
        shippedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      logger.info(`Updated order ${orderDetails.orderNumber} status to shipped`);
    }

    // Send shipping notification email
    if (apiKey && ordersSender) {
      const brevoPayload = {
        sender: ordersSender,
        to: [{ email: email }],
        templateId: templates.orderShipped,
        params: {
          EMAIL: email,
          ORDER_NUMBER: orderDetails.orderNumber || 'N/A',
          CUSTOMER_NAME: orderDetails.customerName || '',
          TRACKING_NUMBER: shippingDetails.trackingNumber || '',
          CARRIER: shippingDetails.carrier || '',
          TRACKING_URL: shippingDetails.trackingUrl || '',
          ESTIMATED_DELIVERY: shippingDetails.estimatedDelivery || '',
          SHIPPING_ADDRESS: orderDetails.shippingAddress || ''
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
        throw new Error(`Failed to send shipping notification: ${response.status}`);
      }

      logger.info(`Successfully sent shipping notification to ${email}`);
    } else {
      logger.warn("Brevo API key or orders sender not configured. Skipping email.");
    }

    return {
      success: true,
      message: "Shipping notification sent!",
      orderNumber: orderDetails.orderNumber,
      trackingNumber: shippingDetails.trackingNumber
    };

  } catch (error) {
    logger.error("Order shipped notification error:", error);
    throw new Error("Failed to send shipping notification");
  }
});

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
