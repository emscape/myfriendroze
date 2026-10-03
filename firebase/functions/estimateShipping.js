const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const {
  validateParcel,
  shipmentRequest,
  groundAdvantageAmount,
  suggestedShipping,
  ParcelError,
  DESTINATIONS,
} = require('./lib/shippingEstimate');

const shippoApiKey = defineSecret('SHIPPO_API_KEY');

const SHIPPO_SHIPMENTS_URL = 'https://api.goshippo.com/shipments/';

// Same admin allowlist as orderShipped.js/eventNotification.js/
// firestore.rules' isAdmin() -- kept in sync manually. Without it, anyone
// could spend this project's Shippo quota.
const ADMIN_EMAILS = ['myfriendroze@gmail.com', 'myfriendroze.store@gmail.com'];

const UNAVAILABLE = "Couldn't get a USPS quote right now. Try again in a moment.";

async function quote(parcel, destination, { apiKey, fetchImpl, logger }) {
  let response;
  try {
    response = await fetchImpl(SHIPPO_SHIPMENTS_URL, {
      method: 'POST',
      headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(shipmentRequest(parcel, destination.zip)),
    });
  } catch (error) {
    logger.error('Shippo request failed:', error.message);
    throw new HttpsError('unavailable', UNAVAILABLE);
  }
  if (!response.ok) {
    logger.error('Shippo returned HTTP', response.status);
    throw new HttpsError('unavailable', UNAVAILABLE);
  }
  let shipment;
  try {
    shipment = await response.json();
  } catch (error) {
    logger.error('Shippo returned an unreadable response:', error.message);
    throw new HttpsError('unavailable', UNAVAILABLE);
  }
  const amount = groundAdvantageAmount(shipment);
  if (amount === null) {
    logger.warn('Shippo returned no Ground Advantage rate for', destination.zip);
    throw new HttpsError('unavailable', UNAVAILABLE);
  }
  return { label: destination.label, zip: destination.zip, amount };
}

/**
 * Testable core — the Shippo key and fetch are passed in, like
 * orderShipped.js's handler, so tests need no network or secrets.
 */
async function handleEstimateShipping(request, { apiKey, fetchImpl, logger }) {
  if (!request.auth || !ADMIN_EMAILS.includes(request.auth.token.email)) {
    throw new HttpsError('permission-denied', 'Admin access required');
  }

  let parcel;
  try {
    parcel = validateParcel(request.data);
  } catch (error) {
    if (error instanceof ParcelError) {
      throw new HttpsError('invalid-argument', error.message);
    }
    throw error;
  }

  const quotes = await Promise.all(DESTINATIONS.map((d) => quote(parcel, d, { apiKey, fetchImpl, logger })));
  const far = quotes[DESTINATIONS.findIndex((d) => d.basisForSuggestion)];

  return {
    quotes,
    suggestedShipping: suggestedShipping(far.amount),
    // Until the live key is set, prices come from Shippo's test mode.
    testMode: apiKey.startsWith('shippo_test_'),
  };
}

/* v8 ignore start -- thin wiring: hands the deployed secret and global
   fetch to the tested handler above. */
exports.estimateShipping = onCall({ region: 'us-west1', secrets: [shippoApiKey] }, (request) =>
  handleEstimateShipping(request, { apiKey: shippoApiKey.value(), fetchImpl: fetch, logger })
);
/* v8 ignore stop */

exports.handleEstimateShipping = handleEstimateShipping;
