// Pirate Ship API stub for Firebase Cloud Functions
const functions = require('firebase-functions');

exports.getShippingEstimate = functions.https.onCall((data, context) => {
  // TODO: Integrate Pirate Ship API
  // For now, return a fake shipping estimate
  const { zipCode, weight } = data;
  return {
    zipCode,
    weight,
    estimate: '$7.99',
    carrier: 'Pirate Ship (stub)'
  };
});
