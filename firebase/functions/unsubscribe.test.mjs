import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleUnsubscribe } = require('./unsubscribe.js');
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

  // Regression guard: Express parses a repeated query param
  // (?token=a&token=b) into an array, not a string. Caught by the upfront
  // typeof check as an invalid link (400) before ever reaching
  // verifyUnsubscribeToken (which independently also rejects a non-string
  // token, for any other caller that skips this handler's own check).
  it('returns 400 (not a 500) when the token query param is an array', async () => {
    const res = fakeRes();

    await handleUnsubscribe(
      { query: { email: 'buyer@example.com', type: 'newsletter', token: ['a', 'b'] } },
      res,
      { db: fakeDb(), secret: SECRET, serverTimestamp }
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  // Regression guard: a single-element array stringifies identically to its
  // one element via template-literal coercion (${['a@example.com']} ===
  // 'a@example.com'), so a token legitimately issued for a plain-string
  // email would still verify against the array-wrapped form -- and then
  // crash on email.toLowerCase() downstream, since arrays don't have that
  // method. The upfront typeof check rejects the array before either can
  // happen.
  it('returns 400 (not a 500) when email is a single-element array carrying an otherwise-valid token', async () => {
    const email = 'buyer@example.com';
    const token = generateUnsubscribeToken(email, 'newsletter', SECRET);
    const res = fakeRes();

    await handleUnsubscribe(
      { query: { email: [email], type: 'newsletter', token } },
      res,
      { db: fakeDb(), secret: SECRET, serverTimestamp }
    );

    expect(res.status).toHaveBeenCalledWith(400);
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
