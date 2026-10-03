// Shipping estimates for the admin app's product page: what USPS Ground
// Advantage would cost for one piece's box, so Roze can build shipping into
// its price. Quotes come from Shippo (estimates only — postage is bought
// through Pirate Ship, never through this). No network calls here; see
// estimateShipping.js for the callable that uses this.

const ORIGIN_ZIP = '90065';

// Nearby, the farthest lower-48 zone from Los Angeles, and the dearest
// (Alaska and Hawaii price the same). The suggestion is based on the far
// one, so a built-in amount covers any lower-48 order.
const DESTINATIONS = [
  { label: 'Los Angeles', zip: '90012' },
  { label: 'New York', zip: '10001', basisForSuggestion: true },
  { label: 'Alaska / Hawaii', zip: '96813' },
];

const PACKING_ALLOWANCE = 2;
// USPS Ground Advantage limits.
const MAX_WEIGHT_GRAMS = 31751; // 70 lb
const MAX_SIDE_IN = 108;

class ParcelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParcelError';
  }
}

function positive(value, field, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ParcelError(`${field} must be a positive number`);
  }
  if (value > max) {
    throw new ParcelError(`${field} is over the USPS limit of ${max}`);
  }
  return value;
}

/**
 * @param {unknown} data - the callable's request data
 * @returns {{weightGrams: number, lengthIn: number, widthIn: number, heightIn: number}}
 * @throws {ParcelError}
 */
function validateParcel(data) {
  if (!data || typeof data !== 'object') {
    throw new ParcelError('A weight and box size are required');
  }
  return {
    weightGrams: positive(data.weightGrams, 'weightGrams', MAX_WEIGHT_GRAMS),
    lengthIn: positive(data.lengthIn, 'lengthIn', MAX_SIDE_IN),
    widthIn: positive(data.widthIn, 'widthIn', MAX_SIDE_IN),
    heightIn: positive(data.heightIn, 'heightIn', MAX_SIDE_IN),
  };
}

const GRAMS_PER_OUNCE = 28.349523125;

// Shippo quotes from ZIPs alone; no street address is needed for a rate.
// Weight goes in ounces rounded to hundredths: the admin app stores grams
// converted from lb/oz with float noise, and USPS rounds any fraction of a
// pound up, so 3 lb stored as 1360.78 g would otherwise be priced as 4 lb.
function shipmentRequest(parcel, destinationZip) {
  return {
    address_from: { zip: ORIGIN_ZIP, country: 'US' },
    address_to: { zip: destinationZip, country: 'US' },
    parcels: [
      {
        length: String(parcel.lengthIn),
        width: String(parcel.widthIn),
        height: String(parcel.heightIn),
        distance_unit: 'in',
        weight: (parcel.weightGrams / GRAMS_PER_OUNCE).toFixed(2),
        mass_unit: 'oz',
      },
    ],
    async: false,
  };
}

/** @returns {number|null} the Ground Advantage price in dollars */
function groundAdvantageAmount(shipment) {
  const rate = (shipment.rates || []).find((r) => r.servicelevel?.token === 'usps_ground_advantage');
  return rate ? Number(rate.amount) : null;
}

function suggestedShipping(farAmount) {
  return Math.ceil(farAmount + PACKING_ALLOWANCE);
}

module.exports = {
  validateParcel,
  shipmentRequest,
  groundAdvantageAmount,
  suggestedShipping,
  ParcelError,
  ORIGIN_ZIP,
  DESTINATIONS,
};
