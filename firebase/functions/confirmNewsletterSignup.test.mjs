import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleConfirmNewsletterSignup } = require('./confirmNewsletterSignup.js');
const { generateConfirmationToken } = require('./lib/confirmationToken.js');

const SECRET = 'test-secret';
const UNSUB_SECRET = 'unsub-secret';
const NOW = 1700000000000;
const now = () => NOW;
const serverTimestamp = () => 'SERVER_TIMESTAMP';
const EMAIL = 'buyer@example.com';

function fakeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

function fakeDb({ subscriber } = {}) {
  const rollbackUpdate = vi.fn().mockResolvedValue(undefined);
  let currentData = subscriber ? { ...subscriber } : null;
  const docRef = { update: rollbackUpdate };

  return {
    rollbackUpdate,
    getCurrentData: () => currentData,
    collection: () => ({
      where: () => ({
        limit: () => ({
          get: () =>
            Promise.resolve(
              currentData ? { empty: false, docs: [{ ref: docRef }] } : { empty: true, docs: [] }
            ),
        }),
      }),
      doc: () => docRef,
    }),
    runTransaction: (fn) => {
      const tx = {
        get: () => Promise.resolve({ exists: !!currentData, data: () => currentData }),
        set: (ref, data) => { currentData = data; },
        update: (ref, data) => { currentData = { ...currentData, ...data }; },
      };
      return fn(tx);
    },
  };
}

function validFields(overrides = {}) {
  const base = { email: EMAIL, firstName: 'Roze', issuedAt: NOW };
  const merged = { ...base, ...overrides };
  const token = generateConfirmationToken(
    { email: merged.email, firstName: merged.firstName, lastName: merged.lastName, issuedAt: merged.issuedAt },
    SECRET
  );
  return { ...merged, issuedAt: String(merged.issuedAt), token };
}

// GET carries fields as query params -- what the emailed link produces.
// Per the GET-must-be-side-effect-free fix, GET only ever renders the
// interstitial; it never performs the actual confirm.
function getReq(overrides = {}) {
  return { method: 'GET', query: validFields(overrides) };
}

// POST carries fields as a form body -- what clicking the interstitial's
// button actually submits, and the only way to trigger the real side effect.
function postReq(overrides = {}) {
  return { method: 'POST', body: validFields(overrides) };
}

function baseDeps(overrides = {}) {
  return {
    db: fakeDb(),
    secret: SECRET,
    unsubscribeSecret: UNSUB_SECRET,
    now,
    serverTimestamp,
    sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handleConfirmNewsletterSignup', () => {
  describe('validation (same for GET and POST)', () => {
    it('returns 400 when email, issuedAt, or token is missing', async () => {
      const res = fakeRes();
      await handleConfirmNewsletterSignup({ method: 'GET', query: {} }, res, baseDeps());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    // Regression guard, same class of bug fixed in unsubscribe.js: a
    // repeated query param parses as an array, not a string.
    it('returns 400 when email is an array', async () => {
      const res = fakeRes();
      const req = getReq();
      req.query.email = [EMAIL];
      await handleConfirmNewsletterSignup(req, res, baseDeps());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when firstName is an array', async () => {
      const res = fakeRes();
      const req = getReq();
      req.query.firstName = ['Roze', 'Extra'];
      await handleConfirmNewsletterSignup(req, res, baseDeps());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 403 for a token with an invalid signature', async () => {
      const res = fakeRes();
      const req = getReq();
      req.query.token = 'forged-token';
      await handleConfirmNewsletterSignup(req, res, baseDeps());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 403 for an expired token', async () => {
      const res = fakeRes();
      const issuedAt = NOW - 49 * 60 * 60 * 1000; // 49h ago, past the 48h window
      await handleConfirmNewsletterSignup(getReq({ issuedAt }), res, baseDeps());
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // Regression guard: Copilot review on PR #45 -- confirmNewsletterSignup
  // was a plain GET with a real side effect. Email security scanners
  // (Microsoft Safe Links, Proofpoint, etc.) routinely prefetch every link
  // in an incoming email before a human ever clicks it, which would
  // otherwise silently "confirm" a subscription nobody consented to.
  describe('GET (a valid, unexpired token)', () => {
    it('renders the interstitial instead of creating a subscriber record or sending any email', async () => {
      const db = fakeDb();
      const sendWelcomeEmail = vi.fn();
      const res = fakeRes();

      await handleConfirmNewsletterSignup(getReq(), res, baseDeps({ db, sendWelcomeEmail }));

      expect(db.getCurrentData()).toBeNull();
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(400);
      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalled();
      const body = res.send.mock.calls[0][0];
      expect(body).toContain('<form method="POST"');
      expect(body).toContain('name="token" value="');
    });
  });

  describe('POST (the interstitial button submission)', () => {
    it('creates a new subscriber record and sends the welcome email', async () => {
      const db = fakeDb();
      const sendWelcomeEmail = vi.fn().mockResolvedValue(undefined);
      const res = fakeRes();

      await handleConfirmNewsletterSignup(postReq(), res, baseDeps({ db, sendWelcomeEmail }));

      expect(db.getCurrentData()).toEqual(expect.objectContaining({
        email: EMAIL,
        firstName: 'Roze',
        preferences: { newsletter: true },
        welcomeEmailSentAt: 'SERVER_TIMESTAMP',
        timestamp: 'SERVER_TIMESTAMP',
      }));
      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
      const call = sendWelcomeEmail.mock.calls[0][0];
      expect(call.email).toBe(EMAIL);
      expect(call.unsubscribeNewsletter).toContain('type=newsletter');
      expect(call.unsubscribeAll).toContain('type=all');
      expect(res.status).not.toHaveBeenCalledWith(400);
      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.status).not.toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalled();
    });

    it('treats a prior unsubscribe as a resubscribe (a fresh token, never used before) and sends the welcome email again', async () => {
      const db = fakeDb({
        subscriber: { email: EMAIL, preferences: { newsletter: false, orders: true }, confirmedIssuedAt: NOW - 1000 },
      });
      const sendWelcomeEmail = vi.fn().mockResolvedValue(undefined);
      const res = fakeRes();

      await handleConfirmNewsletterSignup(postReq(), res, baseDeps({ db, sendWelcomeEmail }));

      expect(db.getCurrentData().preferences).toEqual({ newsletter: true, orders: true });
      // issuedAt arrives as a string from the request, so that's what gets
      // stored -- the replay check coerces both sides with Number() anyway.
      expect(db.getCurrentData().confirmedIssuedAt).toBe(String(NOW));
      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
    });

    // Regression guard: clicking the *same* confirmation link a second
    // time, after having explicitly unsubscribed in between, used to
    // silently resubscribe the user and send another welcome email, with
    // no new signup ever submitted. The link is valid for up to 48h, so
    // this was a realistic replay window, not a theoretical one.
    it('refuses to resubscribe via the exact same token that already confirmed this doc once before', async () => {
      const db = fakeDb({
        subscriber: { email: EMAIL, preferences: { newsletter: false }, confirmedIssuedAt: NOW },
      });
      const sendWelcomeEmail = vi.fn();
      const res = fakeRes();

      await handleConfirmNewsletterSignup(postReq(), res, baseDeps({ db, sendWelcomeEmail }));

      expect(sendWelcomeEmail).not.toHaveBeenCalled();
      expect(db.getCurrentData().preferences).toEqual({ newsletter: false });
      expect(res.status).not.toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalled();
    });

    // Regression guard: Copilot's follow-up on the fix above -- an
    // exact-match check alone misses an *older*, never-yet-used token.
    // Two outstanding tokens (e.g. the visitor submitted the signup form
    // twice): confirm with the newer one (issuedAt 2000), unsubscribe,
    // then open the *older* one (issuedAt 1000, still valid for 48h). That
    // older token was never the one that set confirmedIssuedAt, so an
    // exact-match check would wrongly treat it as fresh and resubscribe.
    it('also refuses an older, never-before-used token once a newer one has already confirmed', async () => {
      const db = fakeDb({
        subscriber: { email: EMAIL, preferences: { newsletter: false }, confirmedIssuedAt: NOW }, // confirmed with issuedAt=NOW
      });
      const sendWelcomeEmail = vi.fn();
      const res = fakeRes();
      const olderIssuedAt = NOW - 1000; // an older token, minted before the one that confirmed

      await handleConfirmNewsletterSignup(postReq({ issuedAt: olderIssuedAt }), res, baseDeps({ db, sendWelcomeEmail }));

      expect(sendWelcomeEmail).not.toHaveBeenCalled();
      expect(db.getCurrentData().preferences).toEqual({ newsletter: false });
    });

    it('retries delivery when a prior send was rolled back (welcomeEmailSentAt explicitly null)', async () => {
      const db = fakeDb({
        subscriber: { email: EMAIL, preferences: { newsletter: true }, welcomeEmailSentAt: null },
      });
      const sendWelcomeEmail = vi.fn().mockResolvedValue(undefined);
      const res = fakeRes();

      await handleConfirmNewsletterSignup(postReq(), res, baseDeps({ db, sendWelcomeEmail }));

      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
    });

    it('backfills a legacy doc missing welcomeEmailSentAt entirely without sending a new email', async () => {
      const db = fakeDb({ subscriber: { email: EMAIL, preferences: { newsletter: true } } });
      const sendWelcomeEmail = vi.fn();
      const res = fakeRes();

      await handleConfirmNewsletterSignup(postReq(), res, baseDeps({ db, sendWelcomeEmail }));

      expect(sendWelcomeEmail).not.toHaveBeenCalled();
      expect(db.getCurrentData()).toHaveProperty('welcomeEmailSentAt');
      expect(res.send).toHaveBeenCalled();
    });

    it('does nothing further for an already-delivered subscriber, but still shows a success page', async () => {
      const db = fakeDb({
        subscriber: { email: EMAIL, preferences: { newsletter: true }, welcomeEmailSentAt: 'already-sent' },
      });
      const sendWelcomeEmail = vi.fn();
      const res = fakeRes();

      await handleConfirmNewsletterSignup(postReq(), res, baseDeps({ db, sendWelcomeEmail }));

      expect(sendWelcomeEmail).not.toHaveBeenCalled();
      expect(res.send).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(500);
    });

    // Regression guard: Copilot review follow-up -- a valid, newer token
    // opened while the subscriber is already active used to leave
    // confirmedIssuedAt untouched, since nothing needed (re)sending. If
    // that subscriber later unsubscribed, the exact same "already used"
    // token would still look unconsumed to the replay check and could
    // resubscribe them a second time.
    it('advances the high-water mark even when nothing needs sending, so this token cannot later replay a resubscribe', async () => {
      const db = fakeDb({
        subscriber: {
          email: EMAIL,
          preferences: { newsletter: true },
          welcomeEmailSentAt: 'already-sent',
          confirmedIssuedAt: String(NOW - 5000), // an older, already-recorded token
        },
      });
      const sendWelcomeEmail = vi.fn();
      const res = fakeRes();

      // A newer token than the one on record, opened while still subscribed.
      await handleConfirmNewsletterSignup(postReq(), res, baseDeps({ db, sendWelcomeEmail }));

      expect(sendWelcomeEmail).not.toHaveBeenCalled();
      expect(db.getCurrentData().confirmedIssuedAt).toBe(String(NOW));
    });

    it('rolls back the delivery claim and returns 500 if sending the welcome email fails', async () => {
      const db = fakeDb();
      const res = fakeRes();

      await handleConfirmNewsletterSignup(
        postReq(),
        res,
        baseDeps({ db, sendWelcomeEmail: vi.fn().mockRejectedValue(new Error('brevo down')) })
      );

      expect(db.rollbackUpdate).toHaveBeenCalledWith({ welcomeEmailSentAt: null });
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 500 if the Firestore transaction fails', async () => {
      const db = fakeDb();
      db.runTransaction = () => Promise.reject(new Error('firestore down'));
      const res = fakeRes();

      await handleConfirmNewsletterSignup(postReq(), res, baseDeps({ db }));

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
