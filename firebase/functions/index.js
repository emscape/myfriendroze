// USPS Web Tools API integration for shipping rate calculation
// Uses USPS RateV4 API (which PirateShip uses under the hood)
const { onCall } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const fetch = require("node-fetch");
const xml2js = require("xml2js");

// USPS Web Tools API configuration
const USPS_API_URL = "https://secure.shippingapis.com/ShippingAPI.dll";
const USPS_USER_ID = process.env.USPS_USER_ID || "DEMO_USER";
const ORIGIN_ZIP = "90210"; // Roze's origin zip code (can be made configurable)

// Parse XML response
const parseXML = async (xmlString) => {
  const parser = new xml2js.Parser();
  return parser.parseStringPromise(xmlString);
};

// Build USPS RateV4 XML request
const buildUSPSRequest = (zipCode, weight) => {
  const pounds = Math.floor(weight);
  const ounces = Math.round((weight - pounds) * 16);

  return `<RateV4Request USERID="${USPS_USER_ID}">
    <Revision>2</Revision>
    <Package ID="1">
      <Service>PRIORITY</Service>
      <ZipOrigination>${ORIGIN_ZIP}</ZipOrigination>
      <ZipDestination>${zipCode}</ZipDestination>
      <Pounds>${pounds}</Pounds>
      <Ounces>${ounces}</Ounces>
      <Container>VARIABLE</Container>
    </Package>
  </RateV4Request>`;
};

exports.getShippingEstimate = onCall(async (request) => {
  try {
    const { zipCode, weight } = request.data;

    // Validate inputs
    if (!zipCode || !/^\d{5}$/.test(zipCode)) {
      throw new Error("Invalid zip code format");
    }
    if (!weight || weight <= 0) {
      throw new Error("Invalid weight");
    }

    logger.info(`Calculating shipping for zip: ${zipCode}, weight: ${weight}lbs`);

    // Build USPS request
    const xmlRequest = buildUSPSRequest(zipCode, weight);

    // Call USPS API
    const response = await fetch(
      `${USPS_API_URL}?API=RateV4&XML=${encodeURIComponent(xmlRequest)}`
    );

    if (!response.ok) {
      throw new Error(`USPS API error: ${response.statusText}`);
    }

    const xmlResponse = await response.text();
    logger.info(`USPS Response: ${xmlResponse}`);

    // Parse XML response
    const parsed = await parseXML(xmlResponse);

    // Check for errors
    if (parsed.RateV4Response?.Error) {
      const error = parsed.RateV4Response.Error[0];
      throw new Error(`USPS Error: ${error.Description[0]}`);
    }

    // Extract rate from response
    const packageData = parsed.RateV4Response?.Package?.[0];
    if (!packageData) {
      throw new Error("No rate data in USPS response");
    }

    const postage = packageData.Postage?.[0];
    if (!postage) {
      throw new Error("No postage rate found");
    }

    const rate = parseFloat(postage);

    // USPS Priority Mail has a base rate; weight charge is the remainder
    // Base rate for Priority Mail is approximately $8.70 for lightweight packages
    const baseRate = Math.min(8.70, rate);
    const weightCharge = Math.max(0, rate - baseRate);

    return {
      success: true,
      data: {
        zipCode,
        weight,
        baseRate: parseFloat(baseRate.toFixed(2)),
        weightCharge: parseFloat(weightCharge.toFixed(2)),
        totalCost: rate,
        carrier: "USPS Priority Mail",
        estimatedDays: "1-3 business days",
        service: "Priority Mail",
      },
    };
  } catch (error) {
    logger.error("Shipping calculation error:", error);
    return {
      success: false,
      error: error.message || "Failed to calculate shipping",
    };
  }
});

// Newsletter signup Cloud Function
exports.newsletterSignup = require('./newsletterSignup').newsletterSignup;

// Stripe Checkout session creation
exports.createCheckoutSession = require('./createCheckoutSession').createCheckoutSession;

// Stripe webhook — creates the order once payment is actually confirmed
exports.stripeWebhook = require('./stripeWebhook').stripeWebhook;

// Admin-only: resend an order confirmation email
exports.resendOrderConfirmation = require('./orderConfirmation').resendOrderConfirmation;
exports.ssrAstro = require('./ssrAstro').ssrAstro;
