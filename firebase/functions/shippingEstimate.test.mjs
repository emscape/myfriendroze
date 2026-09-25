import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleGetShippingEstimate, buildUSPSRequest } = require('./shippingEstimate.js');

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakeResponse({ ok = true, statusText = 'OK', xml = '' } = {}) {
  return { ok, statusText, text: () => Promise.resolve(xml) };
}

const RATE_XML = (rate) => `<RateV4Response>
  <Package ID="1">
    <Postage>${rate}</Postage>
  </Package>
</RateV4Response>`;

const ERROR_XML = (description) => `<RateV4Response>
  <Error>
    <Number>-2147219283</Number>
    <Description>${description}</Description>
  </Error>
</RateV4Response>`;

const baseDeps = (overrides = {}) => ({
  fetchImpl: vi.fn().mockResolvedValue(fakeResponse({ xml: RATE_XML('9.35') })),
  userId: 'TEST_USER',
  originZip: '90210',
  logger: silentLogger(),
  ...overrides,
});

describe('buildUSPSRequest', () => {
  it('splits a fractional weight into whole pounds and rounded ounces', () => {
    const xml = buildUSPSRequest('10001', 2.5, { userId: 'TEST_USER', originZip: '90210' });

    expect(xml).toContain('<Pounds>2</Pounds>');
    expect(xml).toContain('<Ounces>8</Ounces>');
    expect(xml).toContain('<ZipDestination>10001</ZipDestination>');
    expect(xml).toContain('<ZipOrigination>90210</ZipOrigination>');
    expect(xml).toContain('USERID="TEST_USER"');
  });
});

describe('handleGetShippingEstimate', () => {
  it('rejects a missing zip code without calling USPS', async () => {
    const deps = baseDeps();

    const result = await handleGetShippingEstimate({ data: { weight: 1 } }, deps);

    expect(result).toEqual({ success: false, error: 'Invalid zip code format' });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a zip code that is not exactly 5 digits', async () => {
    const deps = baseDeps();

    const result = await handleGetShippingEstimate({ data: { zipCode: '9021', weight: 1 } }, deps);

    expect(result).toEqual({ success: false, error: 'Invalid zip code format' });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a missing weight without calling USPS', async () => {
    const deps = baseDeps();

    const result = await handleGetShippingEstimate({ data: { zipCode: '10001' } }, deps);

    expect(result).toEqual({ success: false, error: 'Invalid weight' });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a zero or negative weight', async () => {
    const deps = baseDeps();

    const result = await handleGetShippingEstimate({ data: { zipCode: '10001', weight: 0 } }, deps);

    expect(result).toEqual({ success: false, error: 'Invalid weight' });
  });

  it('calls USPS with the injected user id and origin zip, and returns a not-ok response as an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, statusText: 'Service Unavailable' }));
    const deps = baseDeps({ fetchImpl });

    const result = await handleGetShippingEstimate({ data: { zipCode: '10001', weight: 1 } }, deps);

    expect(result).toEqual({ success: false, error: 'USPS API error: Service Unavailable' });
    const requestedUrl = fetchImpl.mock.calls[0][0];
    expect(requestedUrl).toContain('API=RateV4');
    expect(decodeURIComponent(requestedUrl)).toContain('USERID="TEST_USER"');
    expect(decodeURIComponent(requestedUrl)).toContain('<ZipOrigination>90210</ZipOrigination>');
  });

  it('surfaces a USPS-reported error (e.g. an invalid zip) from the parsed response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ xml: ERROR_XML('Invalid ZIP Code') }));
    const deps = baseDeps({ fetchImpl });

    const result = await handleGetShippingEstimate({ data: { zipCode: '00000', weight: 1 } }, deps);

    expect(result).toEqual({ success: false, error: 'USPS Error: Invalid ZIP Code' });
  });

  it('returns an error when the response has no package data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ xml: '<RateV4Response></RateV4Response>' }));
    const deps = baseDeps({ fetchImpl });

    const result = await handleGetShippingEstimate({ data: { zipCode: '10001', weight: 1 } }, deps);

    expect(result).toEqual({ success: false, error: 'No rate data in USPS response' });
  });

  it('returns an error when the package has no postage rate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({
      xml: '<RateV4Response><Package ID="1"></Package></RateV4Response>',
    }));
    const deps = baseDeps({ fetchImpl });

    const result = await handleGetShippingEstimate({ data: { zipCode: '10001', weight: 1 } }, deps);

    expect(result).toEqual({ success: false, error: 'No postage rate found' });
  });

  it('splits a rate at or under the base rate entirely into baseRate, with no weight charge', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ xml: RATE_XML('6.50') }));
    const deps = baseDeps({ fetchImpl });

    const result = await handleGetShippingEstimate({ data: { zipCode: '10001', weight: 1 } }, deps);

    expect(result).toEqual({
      success: true,
      data: {
        zipCode: '10001',
        weight: 1,
        baseRate: 6.5,
        weightCharge: 0,
        totalCost: 6.5,
        carrier: 'USPS Priority Mail',
        estimatedDays: '1-3 business days',
        service: 'Priority Mail',
      },
    });
  });

  it('splits a rate above the base rate into baseRate + weightCharge', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ xml: RATE_XML('12.35') }));
    const deps = baseDeps({ fetchImpl });

    const result = await handleGetShippingEstimate({ data: { zipCode: '10001', weight: 3 } }, deps);

    expect(result).toEqual({
      success: true,
      data: {
        zipCode: '10001',
        weight: 3,
        baseRate: 8.7,
        weightCharge: 3.65,
        totalCost: 12.35,
        carrier: 'USPS Priority Mail',
        estimatedDays: '1-3 business days',
        service: 'Priority Mail',
      },
    });
  });

  it('catches an unexpected failure (e.g. a network error) and reports it as a calculation error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const deps = baseDeps({ fetchImpl });

    const result = await handleGetShippingEstimate({ data: { zipCode: '10001', weight: 1 } }, deps);

    expect(result).toEqual({ success: false, error: 'network down' });
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it('falls back to a generic error message when the failure has none', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(''));
    const deps = baseDeps({ fetchImpl });

    const result = await handleGetShippingEstimate({ data: { zipCode: '10001', weight: 1 } }, deps);

    expect(result).toEqual({ success: false, error: 'Failed to calculate shipping' });
  });
});
