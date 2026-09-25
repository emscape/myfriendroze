// USPS Web Tools API integration for shipping rate calculation
// Uses USPS RateV4 API (which PirateShip uses under the hood)
const { onCall } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const fetch = require("node-fetch");
const xml2js = require("xml2js");

const USPS_API_URL = "https://secure.shippingapis.com/ShippingAPI.dll";

// Parse XML response
const parseXML = async (xmlString) => {
  const parser = new xml2js.Parser();
  return parser.parseStringPromise(xmlString);
};

// Build USPS RateV4 XML request
const buildUSPSRequest = (zipCode, weight, { userId, originZip }) => {
  const pounds = Math.floor(weight);
  const ounces = Math.round((weight - pounds) * 16);

  return `<RateV4Request USERID="${userId}">
    <Revision>2</Revision>
    <Package ID="1">
      <Service>PRIORITY</Service>
      <ZipOrigination>${originZip}</ZipOrigination>
      <ZipDestination>${zipCode}</ZipDestination>
      <Pounds>${pounds}</Pounds>
      <Ounces>${ounces}</Ounces>
      <Container>VARIABLE</Container>
    </Package>
  </RateV4Request>`;
};

/**
 * Testable core — see eventNotification.js's handleSendEventNotification
 * for why dependencies are passed as parameters.
 *
 * KNOWN GAP: `packageData.Postage?.[0]` assumes xml2js parses <Postage> as a
 * plain rate string. USPS's real RateV4Response nests <MailService>/<Rate>
 * child elements inside <Postage> (with a CLASSID attribute), which xml2js
 * would parse as an object, not a string -- parseFloat on that yields NaN.
 * This was already the case before this file was extracted from index.js;
 * fixing it needs a real USPS sandbox response to test against, which is
 * outside this test-coverage task's scope. Tests here document the code's
 * actual, current parsing assumption rather than USPS's real schema.
 */
async function handleGetShippingEstimate(request, { fetchImpl, userId, originZip, logger }) {
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
    const xmlRequest = buildUSPSRequest(zipCode, weight, { userId, originZip });

    // Call USPS API
    const response = await fetchImpl(
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
}

/* v8 ignore start -- thin wiring, same rationale as eventNotification.js's
   wrapper. */
exports.getShippingEstimate = onCall((request) =>
  handleGetShippingEstimate(request, {
    fetchImpl: fetch,
    userId: process.env.USPS_USER_ID || "DEMO_USER",
    originZip: "90210", // Roze's origin zip code (can be made configurable)
    logger,
  })
);
/* v8 ignore stop */

// Exported separately for testing.
exports.handleGetShippingEstimate = handleGetShippingEstimate;
exports.buildUSPSRequest = buildUSPSRequest;
