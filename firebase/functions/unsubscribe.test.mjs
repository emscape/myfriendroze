import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  handleUnsubscribe,
  handleGenerateUnsubscribeUrls,
  buildUnsubscribeUrls,
  HttpsError,
} = require('./unsubscribe.js');
const { generateUnsubscribeToken } = require('./lib/unsubscribeToken.js');

const SECRET = 'test-secret';
const serverTimestamp = () => 'SERVER_TIMESTAMP';

function fakeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

function fakeDb({ subscriber } = {}) {
  const update = vi.fn().mockResolvedValue(undefined);
  return {
    update,
    collection: () => ({
      where: () => ({
        get: () => Promise.resolve(
          subscriber
            ? { empty: false, docs: [{ data: () => subscriber, ref: { update } }] }
            : { empty: true, docs: [] }
        ),
      }),
    }),
  };
}

describe('buildUnsubscribeUrls', () => {
  it('builds newsletter/events/all links, each carrying its own valid token', () => {
    const urls = buildUnsubscribeUrls('buyer@example.com', SECRET);

    expect(urls.newsletter).toContain('type=newsletter');
    expect(urls.events).toContain('type=events');
    expect(urls.all).toContain('type=all');
    expect(urls.newsletter).toContain(
      `token=${generateUnsubscribeToken('buyer@example.com', 'newsletter', SECRET)}`
    );
  });
});

describe('handleGenerateUnsubscribeUrls', () => {
  it('rejects a request with no email', async () => {
    await expect(
      handleGenerateUnsubscribeUrls({ data: {} }, { secret: SECRET })
    ).rejects.toThrow(HttpsError);
  });

  it('returns unsubscribe URLs for a given email', async () => {
    const result = await handleGenerateUnsubscribeUrls(
      { data: { email: 'buyer@example.com' } },
      { secret: SECRET }
    );

    expect(result.newsletter).toContain('email=buyer%40example.com');
  });
});

describe('handleUnsubscribe', () => {
  it('returns 400 when email, type, or token is missing', async () => {
    const res = fakeRes();

    await handleUnsubscribe({ query: {} }, res, { db: fakeDb(), secret: SECRET, serverTimestamp });

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 403 for an invalid token', async () => {
    const res = fakeRes();

    await handleUnsubscribe(
      { query: { email: 'buyer@example.com', type: 'newsletter', token: 'wrong' } },
      res,
      { db: fakeDb(), secret: SECRET, serverTimestamp }
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  // Regression guard for the reflected-XSS finding: unsubscribe.js used to
  // interpolate the raw `email` query param straight into the "not found"
  // HTML response with no escaping.
  it('escapes the email in the "not found" page instead of reflecting it raw', async () => {
    const email = '<script>alert(1)</script>@example.com';
    const token = generateUnsubscribeToken(email, 'newsletter', SECRET);
    const res = fakeRes();

    await handleUnsubscribe(
      { query: { email, type: 'newsletter', token } },
      res,
      { db: fakeDb(), secret: SECRET, serverTimestamp }
    );

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.send.mock.calls[0][0];
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;');
  });

  it('unsubscribes from newsletter only, preserving other preference fields', async () => {
    const email = 'buyer@example.com';
    const token = generateUnsubscribeToken(email, 'newsletter', SECRET);
    const db = fakeDb({ subscriber: { email, preferences: { newsletter: true, events: true } } });
    const res = fakeRes();

    await handleUnsubscribe(
      { query: { email, type: 'newsletter', token } },
      res,
      { db, secret: SECRET, serverTimestamp }
    );

    expect(db.update).toHaveBeenCalledWith({
      preferences: { newsletter: false, events: true },
      unsubscribedAt: 'SERVER_TIMESTAMP',
      unsubscribeType: 'newsletter',
    });
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalled();
  });

  it('unsubscribing from "all" keeps orders true for legal record-keeping', async () => {
    const email = 'buyer@example.com';
    const token = generateUnsubscribeToken(email, 'all', SECRET);
    const db = fakeDb({ subscriber: { email, preferences: { newsletter: true, events: true } } });
    const res = fakeRes();

    await handleUnsubscribe({ query: { email, type: 'all', token } }, res, {
      db, secret: SECRET, serverTimestamp,
    });

    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      preferences: { newsletter: false, events: false, orders: true },
    }));
  });

  it('returns 400 for an unrecognized unsubscribe type', async () => {
    const email = 'buyer@example.com';
    const token = generateUnsubscribeToken(email, 'bogus', SECRET);
    const db = fakeDb({ subscriber: { email, preferences: {} } });
    const res = fakeRes();

    await handleUnsubscribe({ query: { email, type: 'bogus', token } }, res, {
      db, secret: SECRET, serverTimestamp,
    });

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 500 if the Firestore lookup fails', async () => {
    const email = 'buyer@example.com';
    const token = generateUnsubscribeToken(email, 'newsletter', SECRET);
    const db = { collection: () => ({ where: () => ({ get: () => Promise.reject(new Error('boom')) }) }) };
    const res = fakeRes();

    await handleUnsubscribe({ query: { email, type: 'newsletter', token } }, res, {
      db, secret: SECRET, serverTimestamp,
    });

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
