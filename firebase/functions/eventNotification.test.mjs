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

function fakeDb({ subscribers = [], eventId = 'event-1' } = {}) {
  const eventsAdd = vi.fn().mockResolvedValue({ id: eventId });
  return {
    eventsAdd,
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
        return { add: eventsAdd };
      }
      throw new Error(`Unexpected collection requested in test: ${name}`);
    },
  };
}

function adminRequest(overrides = {}) {
  return {
    auth: { token: { email: ADMIN_EMAIL } },
    data: { eventDetails: { title: 'Pasadena Artwalk', date: '2026-10-01', time: '6pm' } },
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
    ).rejects.toThrow(HttpsError);
  });

  it('rejects requests from a non-admin email', async () => {
    await expect(
      handleSendEventNotification(
        { auth: { token: { email: 'stranger@example.com' } }, data: {} },
        { db: fakeDb(), sendBrevoEmail: vi.fn(), ...baseDeps() }
      )
    ).rejects.toThrow(HttpsError);
  });

  it('rejects a request missing eventDetails', async () => {
    await expect(
      handleSendEventNotification(
        adminRequest({ data: {} }),
        { db: fakeDb(), sendBrevoEmail: vi.fn(), ...baseDeps() }
      )
    ).rejects.toThrow(HttpsError);
  });

  it('returns early with no emails sent when there are no events-subscribers', async () => {
    const db = fakeDb({ subscribers: [] });
    const sendBrevoEmail = vi.fn();

    const result = await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps() });

    expect(result).toEqual({ success: true, message: 'No subscribers to notify', emailsSent: 0 });
    expect(sendBrevoEmail).not.toHaveBeenCalled();
    expect(db.eventsAdd).not.toHaveBeenCalled();
  });

  it('saves the event and emails every events-subscriber with a per-recipient unsubscribe link', async () => {
    const db = fakeDb({ subscribers: ['a@example.com', 'b@example.com'] });
    const sendBrevoEmail = vi.fn().mockResolvedValue(undefined);

    const result = await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps() });

    expect(db.eventsAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Pasadena Artwalk',
      isActive: true,
      notificationSent: true,
      recipientCount: 2,
      timestamp: 'SERVER_TIMESTAMP',
    }));
    expect(sendBrevoEmail).toHaveBeenCalledTimes(2);
    const firstPayload = sendBrevoEmail.mock.calls[0][0];
    expect(firstPayload.to).toEqual([{ email: 'a@example.com' }]);
    expect(firstPayload.templateId).toBe('tmpl-1');
    expect(firstPayload.params.UNSUBSCRIBE_EVENTS).toContain('type=events');
    expect(result).toEqual({
      success: true,
      message: 'Event notification sent!',
      eventId: 'event-1',
      emailsSent: 2,
    });
  });

  it('skips sending email (but still saves the event) when Brevo is not configured', async () => {
    const db = fakeDb({ subscribers: ['a@example.com'] });
    const sendBrevoEmail = vi.fn();

    const result = await handleSendEventNotification(adminRequest(), {
      db, sendBrevoEmail, ...baseDeps(), apiKey: null,
    });

    expect(sendBrevoEmail).not.toHaveBeenCalled();
    expect(db.eventsAdd).toHaveBeenCalled();
    expect(result.emailsSent).toBe(1);
  });

  // Regression guard for the PII-logging finding: a failed send used to log
  // the subscriber's raw email address via `Failed to send to ${email}`.
  it('logs a failed send by position, never by the subscriber\'s email address', async () => {
    const db = fakeDb({ subscribers: ['leak-target@example.com'] });
    const sendBrevoEmail = vi.fn().mockRejectedValue(new Error('network down'));
    const logger = silentLogger();

    await handleSendEventNotification(adminRequest(), { db, sendBrevoEmail, ...baseDeps(), logger });

    expect(logger.error).toHaveBeenCalled();
    for (const call of logger.error.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('leak-target@example.com');
    }
  });

  it('wraps an unexpected error (e.g. a Firestore failure) as an internal HttpsError', async () => {
    const db = {
      collection: () => ({ where: () => ({ get: () => Promise.reject(new Error('firestore down')) }) }),
    };
    const logger = silentLogger();

    await expect(
      handleSendEventNotification(adminRequest(), { db, sendBrevoEmail: vi.fn(), ...baseDeps(), logger })
    ).rejects.toThrow(HttpsError);
    expect(logger.error).toHaveBeenCalled();
  });
});
