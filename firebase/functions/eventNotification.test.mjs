import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleSendEventNotification, HttpsError } = require('./eventNotification.js');

const SECRET = 'test-secret';
const ADMIN_EMAIL = 'myfriendroze@gmail.com';
const serverTimestamp = () => 'SERVER_TIMESTAMP';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function ts(date) {
  return { toDate: () => date };
}

function fakeDb({ subscribers = [], event = null, eventId = 'event-1' } = {}) {
  const eventUpdate = vi.fn().mockResolvedValue(undefined);
  const eventGet = vi.fn().mockResolvedValue({
    exists: event !== null,
    data: () => event,
  });
  return {
    eventUpdate,
    eventGet,
    collection: (name) => {
      if (name === 'newsletter_signups') {
        return {
          where: () => ({
            get: () => Promise.resolve({
              empty: subscribers.length === 0,
              docs: subscribers.map((email) => ({ data: () => ({ email }) })),
            }),
          }),
        };
      }
      if (name === 'events') {
        return {
          doc: (id) => {
            if (id !== eventId) throw new Error(`Unexpected event id requested in test: ${id}`);
            return { get: eventGet, update: eventUpdate };
          },
        };
      }
      throw new Error(`Unexpected collection requested in test: ${name}`);
    },
  };
}

function realEvent(overrides = {}) {
  return {
    title: 'Pasadena Artwalk',
    description: '11a - 6p',
    eventDate: ts(new Date('2026-10-04T01:00:00Z')),
    endDate: null,
    location: 'Green St, Pasadena CA',
    link: null,
    ...overrides,
  };
}

function adminRequest(overrides = {}) {
  return {
    auth: { token: { email: ADMIN_EMAIL } },
    data: { eventId: 'event-1' },
    ...overrides,
  };
}

const baseDeps = () => ({
  apiKey: 'brevo-key',
  templates: { eventNotification: 'tmpl-1' },
  eventsSender: { email: 'events@myfriendroze.com', name: 'MyFriendRoze Events' },
  secret: SECRET,
  serverTimestamp,
  logger: silentLogger(),
});

describe('handleSendEventNotification', () => {
  it('rejects unauthenticated requests', async () => {
    await expect(
      handleSendEventNotification(
        { auth: null, data: {} },
        { db: fakeDb(), sendBrevoEmail: vi.fn(), ...baseDeps() }
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects requests from a non-admin email', async () => {
    await expect(
      handleSendEventNotification(
        { auth: { token: { email: 'stranger@example.com' } }, data: {} },
        { db: fakeDb(), sendBrevoEmail: vi.fn(), ...baseDeps() }
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a request missing eventId', async () => {
    await expect(
      handleSendEventNotification(
        adminRequest({ data: {} }),
        { db: fakeDb(), sendBrevoEmail: vi.fn(), ...baseDeps() }
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects with not-found when the event does not exist', async () => {
    const db = fakeDb({ event: null });

    await expect(
      handleSendEventNotification(adminRequest(), { db, sendBrevoEmail: vi.fn(), ...baseDeps() })
    ).rejects.toMatchObject({ code: 'not-found', message: 'Event not found' });
    expect(db.eventUpdate).not.toHaveBeenCalled();
  });

  it('returns early with no emails sent when there are no events-subscribers', async () => {
    const db = fakeDb({ subscribers: [], event: realEvent() });
    const sendBrevoEmail = vi.fn();

    const result = await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps() });

    expect(result).toEqual({ success: true, message: 'No subscribers to notify', emailsSent: 0 });
    expect(sendBrevoEmail).not.toHaveBeenCalled();
    expect(db.eventUpdate).not.toHaveBeenCalled();
  });

  it('does NOT create a new event doc -- only reads and updates the existing one', async () => {
    const db = fakeDb({ subscribers: ['a@example.com'], event: realEvent() });
    const sendBrevoEmail = vi.fn().mockResolvedValue(undefined);

    await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps() });

    expect(db.eventGet).toHaveBeenCalled();
  });

  it('emails every events-subscriber using the REAL event fields, with a per-recipient unsubscribe link', async () => {
    const db = fakeDb({
      subscribers: ['a@example.com', 'b@example.com'],
      event: realEvent({ title: 'Pasadena Artwalk' }),
    });
    const sendBrevoEmail = vi.fn().mockResolvedValue(undefined);

    const result = await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps() });

    expect(sendBrevoEmail).toHaveBeenCalledTimes(2);
    const firstPayload = sendBrevoEmail.mock.calls[0][0];
    expect(firstPayload.to).toEqual([{ email: 'a@example.com' }]);
    expect(firstPayload.templateId).toBe('tmpl-1');
    expect(firstPayload.params.EVENT_TITLE).toBe('Pasadena Artwalk');
    expect(firstPayload.params.UNSUBSCRIBE_EVENTS).toContain('type=events');
    expect(result).toEqual({
      success: true,
      message: 'Event notification sent to 2 of 2 subscribers.',
      eventId: 'event-1',
      emailsSent: 2,
    });
  });

  it('reports the real sent count in the message when some sends fail', async () => {
    const db = fakeDb({ subscribers: ['ok@example.com', 'fails@example.com'], event: realEvent() });
    const sendBrevoEmail = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network down'));

    const result = await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps() });

    expect(result.message).toBe('Event notification sent to 1 of 2 subscribers.');
    expect(result.emailsSent).toBe(1);
  });

  it('records lastNotifiedAt/lastNotificationRecipientCount on the real event doc after sending', async () => {
    const db = fakeDb({ subscribers: ['a@example.com', 'b@example.com'], event: realEvent() });
    const sendBrevoEmail = vi.fn().mockResolvedValue(undefined);

    await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps() });

    expect(db.eventUpdate).toHaveBeenCalledWith({
      lastNotifiedAt: 'SERVER_TIMESTAMP',
      lastNotificationRecipientCount: 2,
    });
  });

  // Emails have already gone out by the time lastNotifiedAt is written, and
  // there's deliberately no idempotency guard -- so if that bookkeeping write
  // failed and surfaced as an error, the caller's natural retry would email
  // every subscriber a second time.
  it('still reports success when recording lastNotifiedAt fails after the emails were sent', async () => {
    const db = fakeDb({ subscribers: ['a@example.com', 'b@example.com'], event: realEvent() });
    db.eventUpdate.mockRejectedValueOnce(new Error('firestore unavailable'));
    const sendBrevoEmail = vi.fn().mockResolvedValue(undefined);
    const logger = silentLogger();

    const result = await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps(), logger });

    expect(sendBrevoEmail).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ success: true, emailsSent: 2 });
    expect(logger.error).toHaveBeenCalled();
  });

  it('does not block re-notifying about the same event -- no idempotency guard', async () => {
    // Unlike orderShipped.js, Roze may legitimately re-notify subscribers
    // about the same event (e.g. a reminder closer to the date), so a prior
    // lastNotifiedAt on the doc must not prevent a second send.
    const db = fakeDb({
      subscribers: ['a@example.com'],
      event: realEvent({ lastNotifiedAt: 'SOME_PAST_TIMESTAMP', lastNotificationRecipientCount: 5 }),
    });
    const sendBrevoEmail = vi.fn().mockResolvedValue(undefined);

    const result = await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps() });

    expect(sendBrevoEmail).toHaveBeenCalledTimes(1);
    expect(result.emailsSent).toBe(1);
  });

  it('skips sending email (but still records the notification) when Brevo is not configured', async () => {
    const db = fakeDb({ subscribers: ['a@example.com'], event: realEvent() });
    const sendBrevoEmail = vi.fn();

    const result = await handleSendEventNotification(adminRequest(), {
      db, sendBrevoEmail, ...baseDeps(), apiKey: null,
    });

    expect(sendBrevoEmail).not.toHaveBeenCalled();
    expect(db.eventUpdate).toHaveBeenCalledWith({
      lastNotifiedAt: 'SERVER_TIMESTAMP',
      lastNotificationRecipientCount: 1,
    });
    expect(result.emailsSent).toBe(0);
    // Must not claim a send that didn't happen.
    expect(result.message).toBe('Event notification recorded, but no emails were sent (Brevo not configured).');
  });

  // Regression guard for the PII-logging finding: a failed send used to log
  // the subscriber's raw email address via `Failed to send to ${email}`.
  it('logs a failed send by position, never by the subscriber\'s email address', async () => {
    const db = fakeDb({ subscribers: ['leak-target@example.com'], event: realEvent() });
    const sendBrevoEmail = vi.fn().mockRejectedValue(new Error('network down'));
    const logger = silentLogger();

    await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps(), logger });

    expect(logger.error).toHaveBeenCalled();
    for (const call of logger.error.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('leak-target@example.com');
    }
  });

  // Regression guard: the failure log used to index into the *filtered*
  // list of failures rather than the original subscriber list, so a later
  // subscriber's failure could misreport an earlier position.
  it('logs the correct 1-based subscriber position when an earlier send succeeded and a later one failed', async () => {
    const db = fakeDb({ subscribers: ['ok@example.com', 'fails@example.com'], event: realEvent() });
    const sendBrevoEmail = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network down'));
    const logger = silentLogger();

    await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps(), logger });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('subscriber 2/2'),
      expect.any(Error)
    );
  });

  it('wraps an unexpected error (e.g. a Firestore failure) as an internal HttpsError', async () => {
    const db = {
      collection: (name) => {
        if (name === 'events') {
          return { doc: () => ({ get: () => Promise.reject(new Error('firestore down')) }) };
        }
        throw new Error(`Unexpected collection requested in test: ${name}`);
      },
    };
    const logger = silentLogger();

    await expect(
      handleSendEventNotification(adminRequest(), { db, sendBrevoEmail: vi.fn(), ...baseDeps(), logger })
    ).rejects.toThrow(HttpsError);
    expect(logger.error).toHaveBeenCalled();
  });
});
