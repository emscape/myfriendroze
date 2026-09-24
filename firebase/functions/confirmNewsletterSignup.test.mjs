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

function validQuery(overrides = {}) {
  const base = { email: EMAIL, firstName: 'Roze', issuedAt: NOW };
  const merged = { ...base, ...overrides };
  const token = generateConfirmationToken(
    { email: merged.email, firstName: merged.firstName, lastName: merged.lastName, issuedAt: merged.issuedAt },
    SECRET
  );
  return { ...merged, issuedAt: String(merged.issuedAt), token };
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
  it('returns 400 when email, issuedAt, or token is missing', async () => {
    const res = fakeRes();
    await handleConfirmNewsletterSignup({ query: {} }, res, baseDeps());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // Regression guard, same class of bug fixed in unsubscribe.js: a
  // repeated query param parses as an array, not a string.
  it('returns 400 when email is an array', async () => {
    const res = fakeRes();
    const query = { ...validQuery(), email: [EMAIL] };
    await handleConfirmNewsletterSignup({ query }, res, baseDeps());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when firstName is an array', async () => {
    const res = fakeRes();
    const query = { ...validQuery(), firstName: ['Roze', 'Extra'] };
    await handleConfirmNewsletterSignup({ query }, res, baseDeps());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 403 for a token with an invalid signature', async () => {
    const res = fakeRes();
    const query = { ...validQuery(), token: 'forged-token' };
    await handleConfirmNewsletterSignup({ query }, res, baseDeps());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 403 for an expired token', async () => {
    const res = fakeRes();
    const issuedAt = NOW - 49 * 60 * 60 * 1000; // 49h ago, past the 48h window
    const query = validQuery({ issuedAt });
    await handleConfirmNewsletterSignup({ query }, res, baseDeps());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('creates a new subscriber record and sends the welcome email', async () => {
    const db = fakeDb();
    const sendWelcomeEmail = vi.fn().mockResolvedValue(undefined);
    const res = fakeRes();

    await handleConfirmNewsletterSignup({ query: validQuery() }, res, baseDeps({ db, sendWelcomeEmail }));

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

  it('treats a prior unsubscribe as a resubscribe and sends the welcome email again', async () => {
    const db = fakeDb({ subscriber: { email: EMAIL, preferences: { newsletter: false, orders: true } } });
    const sendWelcomeEmail = vi.fn().mockResolvedValue(undefined);
    const res = fakeRes();

    await handleConfirmNewsletterSignup({ query: validQuery() }, res, baseDeps({ db, sendWelcomeEmail }));

    expect(db.getCurrentData().preferences).toEqual({ newsletter: true, orders: true });
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it('retries delivery when a prior send was rolled back (welcomeEmailSentAt explicitly null)', async () => {
    const db = fakeDb({
      subscriber: { email: EMAIL, preferences: { newsletter: true }, welcomeEmailSentAt: null },
    });
    const sendWelcomeEmail = vi.fn().mockResolvedValue(undefined);
    const res = fakeRes();

    await handleConfirmNewsletterSignup({ query: validQuery() }, res, baseDeps({ db, sendWelcomeEmail }));

    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it('backfills a legacy doc missing welcomeEmailSentAt entirely without sending a new email', async () => {
    const db = fakeDb({ subscriber: { email: EMAIL, preferences: { newsletter: true } } });
    const sendWelcomeEmail = vi.fn();
    const res = fakeRes();

    await handleConfirmNewsletterSignup({ query: validQuery() }, res, baseDeps({ db, sendWelcomeEmail }));

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

    await handleConfirmNewsletterSignup({ query: validQuery() }, res, baseDeps({ db, sendWelcomeEmail }));

    expect(sendWelcomeEmail).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it('rolls back the delivery claim and returns 500 if sending the welcome email fails', async () => {
    const db = fakeDb();
    const res = fakeRes();

    await handleConfirmNewsletterSignup(
      { query: validQuery() },
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

    await handleConfirmNewsletterSignup({ query: validQuery() }, res, baseDeps({ db }));

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
