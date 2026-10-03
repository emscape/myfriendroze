import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import — see pricing.test.mjs for why.
const require = createRequire(import.meta.url);
const {
  validateParcel,
  shipmentRequest,
  groundAdvantageAmount,
  suggestedShipping,
  ParcelError,
  ORIGIN_ZIP,
  DESTINATIONS,
} = require('./shippingEstimate.js');

const BOX = { weightGrams: 1360, lengthIn: 12, widthIn: 10, heightIn: 8 };

describe('validateParcel', () => {
  it('accepts a positive weight and box size', () => {
    expect(validateParcel(BOX)).toEqual(BOX);
  });

  it('rejects a missing, zero or non-numeric field, naming it', () => {
    for (const field of ['weightGrams', 'lengthIn', 'widthIn', 'heightIn']) {
      for (const bad of [undefined, 0, -1, '12', NaN, Infinity]) {
        expect(() => validateParcel({ ...BOX, [field]: bad }), `${field}=${bad}`).toThrow(new RegExp(field));
      }
    }
  });

  it('accepts exactly 70 lb and rejects anything over the USPS limit', () => {
    const seventyLb = 70 * 16 * 28.349523125; // 31751.4659 g, as the admin app converts it
    expect(validateParcel({ ...BOX, weightGrams: seventyLb }).weightGrams).toBe(seventyLb);
    expect(() => validateParcel({ ...BOX, weightGrams: seventyLb + 0.01 })).toThrow(ParcelError);
  });

  it('rejects a box side over 108 inches', () => {
    expect(() => validateParcel({ ...BOX, lengthIn: 109 })).toThrow(ParcelError);
  });

  // USPS: longest side + 2 × (the other two sides) at most 130 in.
  it('accepts a box at exactly the 130-inch length-plus-girth limit, whichever side is longest', () => {
    expect(() => validateParcel({ ...BOX, lengthIn: 30, widthIn: 25, heightIn: 25 })).not.toThrow();
    expect(() => validateParcel({ ...BOX, lengthIn: 25, widthIn: 25, heightIn: 30 })).not.toThrow();
  });

  it('rejects a box over the 130-inch length-plus-girth limit', () => {
    expect(() => validateParcel({ ...BOX, lengthIn: 30, widthIn: 25, heightIn: 25.5 })).toThrow(/130/);
    expect(() => validateParcel({ ...BOX, lengthIn: 108, widthIn: 108, heightIn: 108 })).toThrow(ParcelError);
  });

  it('rejects a missing request body', () => {
    expect(() => validateParcel(undefined)).toThrow(ParcelError);
  });
});

describe('shipmentRequest', () => {
  it('quotes from the origin ZIP to the given ZIP, by ZIP alone', () => {
    expect(ORIGIN_ZIP).toBe('90065');
    expect(shipmentRequest(BOX, '10001')).toEqual({
      address_from: { zip: '90065', country: 'US' },
      address_to: { zip: '10001', country: 'US' },
      parcels: [
        { length: '12', width: '10', height: '8', distance_unit: 'in', weight: '47.97', mass_unit: 'oz' },
      ],
      async: false,
    });
  });

  // The admin app stores weights converted from lb/oz with float noise;
  // USPS rounds any fraction of a pound up, so 3 lb stored as 1360.78 g
  // must not be quoted as 4 lb.
  it('sends the sides longest first, whichever field each was entered in', () => {
    const request = shipmentRequest({ ...BOX, lengthIn: 8, widthIn: 12, heightIn: 10 }, '10001');
    expect(request.parcels[0]).toMatchObject({ length: '12', width: '10', height: '8' });
  });

  it('sends the weight in ounces rounded to hundredths', () => {
    const request = shipmentRequest({ ...BOX, weightGrams: 1360.7777 }, '10001');
    expect(request.parcels[0].weight).toBe('48.00');
    expect(shipmentRequest({ ...BOX, weightGrams: 1360.78 }, '10001').parcels[0].weight).toBe('48.00');
  });
});

describe('groundAdvantageAmount', () => {
  it('returns the USPS Ground Advantage price', () => {
    const response = {
      rates: [
        { provider: 'USPS', servicelevel: { token: 'usps_priority' }, amount: '18.35' },
        { provider: 'USPS', servicelevel: { token: 'usps_ground_advantage' }, amount: '11.30' },
      ],
    };
    expect(groundAdvantageAmount(response)).toBe(11.3);
  });

  it('returns null when the Ground Advantage amount is not a number', () => {
    const rate = (amount) => ({ rates: [{ servicelevel: { token: 'usps_ground_advantage' }, amount }] });
    for (const amount of ['abc', '', null, undefined, 'Infinity']) {
      expect(groundAdvantageAmount(rate(amount)), String(amount)).toBeNull();
    }
  });

  it('returns null for a zero or negative amount, which no postage costs', () => {
    const rate = (amount) => ({ rates: [{ servicelevel: { token: 'usps_ground_advantage' }, amount }] });
    for (const amount of ['0', '0.00', '-5.98', -1]) {
      expect(groundAdvantageAmount(rate(amount)), String(amount)).toBeNull();
    }
    expect(groundAdvantageAmount(rate('0.01'))).toBe(0.01);
  });

  it('returns null for a malformed response instead of throwing', () => {
    for (const shipment of [null, undefined, 'oops', { rates: null }, { rates: 'x' }, { rates: [null, 5] }]) {
      expect(groundAdvantageAmount(shipment), JSON.stringify(shipment)).toBeNull();
    }
  });

  it('returns null when there is no Ground Advantage rate', () => {
    expect(groundAdvantageAmount({ rates: [] })).toBeNull();
    expect(groundAdvantageAmount({})).toBeNull();
  });
});

describe('suggestedShipping', () => {
  it('adds $2 for packing and rounds up to a whole dollar', () => {
    expect(suggestedShipping(11.3)).toBe(14);
    expect(suggestedShipping(10)).toBe(12);
  });
});

describe('DESTINATIONS', () => {
  it('covers Los Angeles, the farthest lower-48 zone, and Alaska/Hawaii, with the far one marked', () => {
    expect(DESTINATIONS.map((d) => d.zip)).toEqual(['90012', '10001', '96813']);
    expect(DESTINATIONS.filter((d) => d.basisForSuggestion).map((d) => d.zip)).toEqual(['10001']);
  });
});
