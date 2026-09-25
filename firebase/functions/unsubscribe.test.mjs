import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleUnsubscribe } = require('./unsubscribe.js');
const { generateUnsubscribeToken } = require('./lib/unsubscribeToken.js');

const SECRET = 'test-secret';
const serverTimestamp = () => 'SERVER_TIMESTAMP';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

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

function baseDeps(overrides = {}) {
  return {
    db: fakeDb(),
    secret: SECRET,
    serverTimestamp,
    logger: silentLogger(),
    ...overrides,
  };
}

// GET carries fields as query params -- what the emailed link produces.
// Per the GET-must-be-side-effect-free fix, GET only ever renders the
// interstitial; it never performs the actual preference update.
function getReq(fields) {
  return { method: 'GET', query: fields };
}

// POST carries fields as a form body -- what clicking the interstitial's
// button actually submits, and the only way to trigger the real update.
function postReq(fields) {
  return { method: 'POST', body: fields };
}

describe('handleUnsubscribe', () => {
  describe('validation (same for GET and POST)', () => {
    it('returns 400 when email, type, or token is missing', async () => {
      const res = fakeRes();
      await handleUnsubscribe(getReq({}), res, baseDeps());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 403 for an invalid token', async () => {
      const res = fakeRes();
      await handleUnsubscribe(
        getReq({ email: 'buyer@example.com', type: 'newsletter', token: 'wrong' }),
        res,
        baseDeps()
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    // Regression guard: Express parses a repeated query param
    // (?token=a&token=b) into an array, not a string. Caught by the
    // upfront typeof check as an invalid link (400) before ever reaching
    // verifyUnsubscribeToken (which independently also rejects a
    // non-string token, for any other caller that skips this check).
    it('returns 400 (not a 500) when the token query param is an array', async () => {
      const res = fakeRes();
      await handleUnsubscribe(
        getReq({ email: 'buyer@example.com', type: 'newsletter', token: ['a', 'b'] }),
        res,
        baseDeps()
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    // Regression guard: a single-element array stringifies identically to
    // its one element via template-literal coercion
    // (${['a@example.com']} === 'a@example.com'), so a token legitimately
    // issued for a plain-string email would still verify against the
    // array-wrapped form -- and then crash on email.toLowerCase()
    // downstream. The upfront typeof check rejects the array first.
    it('returns 400 (not a 500) when email is a single-element array carrying an otherwise-valid token', async () => {
      const email = 'buyer@example.com';
      const token = generateUnsubscribeToken(email, 'newsletter', SECRET);
      const res = fakeRes();

      await handleUnsubscribe(getReq({ email: [email], type: 'newsletter', token }), res, baseDeps());

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // Regression guard: Copilot review on PR #45 -- unsubscribe.js was a
  // plain GET with a real side effect, now that it's wired live for the
  // welcome email's unsubscribe links. Email security scanners (Microsoft
  // Safe Links, Proofpoint, etc.) routinely prefetch every link in an
  // incoming email, which would silently unsubscribe a real recipient who
  // never clicked anything.
  describe('GET (a valid token)', () => {
    it('renders the interstitial instead of updating any preference', async () => {
      const email = 'buyer@example.com';
      const token = generateUnsubscribeToken(email, 'newsletter', SECRET);
      const db = fakeDb({ subscriber: { email, preferences: { newsletter: true } } });
      const res = fakeRes();

      await handleUnsubscribe(getReq({ email, type: 'newsletter', token }), res, baseDeps({ db }));

      expect(db.update).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(400);
      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.status).not.toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalled();
      const body = res.send.mock.calls[0][0];
      expect(body).toContain('<form method="POST"');
      expect(body).toContain('name="token" value="');
    });
  });

  describe('POST (the interstitial button submission)', () => {
    // Regression guard for the reflected-XSS finding: unsubscribe.js used
    // to interpolate the raw `email` query param straight into the "not
    // found" HTML response with no escaping.
    it('escapes the email in the "not found" page instead of reflecting it raw', async () => {
      const email = '<script>alert(1)</script>@example.com';
      const token = generateUnsubscribeToken(email, 'newsletter', SECRET);
      const res = fakeRes();

      await handleUnsubscribe(postReq({ email, type: 'newsletter', token }), res, baseDeps());

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

      await handleUnsubscribe(postReq({ email, type: 'newsletter', token }), res, baseDeps({ db }));

      expect(db.update).toHaveBeenCalledWith({
        preferences: { newsletter: false, events: true },
        unsubscribedAt: 'SERVER_TIMESTAMP',
        unsubscribeType: 'newsletter',
        newsletterUnsubscribedAt: 'SERVER_TIMESTAMP',
      });
      expect(res.status).not.toHaveBeenCalledWith(404);
      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalled();
    });

    it('unsubscribing from "all" keeps orders true for legal record-keeping, and also stamps newsletterUnsubscribedAt', async () => {
      const email = 'buyer@example.com';
      const token = generateUnsubscribeToken(email, 'all', SECRET);
      const db = fakeDb({ subscriber: { email, preferences: { newsletter: true, events: true } } });
      const res = fakeRes();

      await handleUnsubscribe(postReq({ email, type: 'all', token }), res, baseDeps({ db }));

      expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
        preferences: { newsletter: false, events: false, orders: true },
        newsletterUnsubscribedAt: 'SERVER_TIMESTAMP',
      }));
    });

    // Regression guard: Copilot review on PR #45 -- unsubscribedAt is a
    // general "last touched by any unsubscribe action" field, overwritten
    // regardless of type. An events-only unsubscribe must NOT also stamp
    // newsletterUnsubscribedAt, or it would wrongly make a later,
    // legitimate newsletter resubscribe link look stale (see
    // confirmNewsletterSignup.test.mjs's matching regression test).
    it('does not stamp newsletterUnsubscribedAt for an events-only unsubscribe', async () => {
      const email = 'buyer@example.com';
      const token = generateUnsubscribeToken(email, 'events', SECRET);
      const db = fakeDb({ subscriber: { email, preferences: { newsletter: true, events: true } } });
      const res = fakeRes();

      await handleUnsubscribe(postReq({ email, type: 'events', token }), res, baseDeps({ db }));

      expect(db.update).toHaveBeenCalledWith({
        preferences: { newsletter: true, events: false },
        unsubscribedAt: 'SERVER_TIMESTAMP',
        unsubscribeType: 'events',
      });
      const payload = db.update.mock.calls[0][0];
      expect(payload).not.toHaveProperty('newsletterUnsubscribedAt');
    });

    it('returns 400 for an unrecognized unsubscribe type', async () => {
      const email = 'buyer@example.com';
      const token = generateUnsubscribeToken(email, 'bogus', SECRET);
      const db = fakeDb({ subscriber: { email, preferences: {} } });
      const res = fakeRes();

      await handleUnsubscribe(postReq({ email, type: 'bogus', token }), res, baseDeps({ db }));

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 if the Firestore lookup fails', async () => {
      const email = 'buyer@example.com';
      const token = generateUnsubscribeToken(email, 'newsletter', SECRET);
      const db = { collection: () => ({ where: () => ({ get: () => Promise.reject(new Error('boom')) }) }) };
      const res = fakeRes();

      await handleUnsubscribe(postReq({ email, type: 'newsletter', token }), res, baseDeps({ db }));

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // Regression guard: a successful unsubscribe used to log the raw email
    // address (`Unsubscribed ${email} from ${type}`) -- CL9 violation, and
    // this endpoint is now actually deployed, so it will really run in
    // production.
    it('logs the unsubscribe outcome without the subscriber email address', async () => {
      const email = 'leak-target@example.com';
      const token = generateUnsubscribeToken(email, 'newsletter', SECRET);
      const db = fakeDb({ subscriber: { email, preferences: { newsletter: true } } });
      const logger = silentLogger();
      const res = fakeRes();

      await handleUnsubscribe(postReq({ email, type: 'newsletter', token }), res, baseDeps({ db, logger }));

      expect(logger.info).toHaveBeenCalled();
      for (const call of logger.info.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('leak-target@example.com');
      }
    });
  });
});
