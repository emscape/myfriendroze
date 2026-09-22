import { describe, it, expect } from 'vitest';
import { docToEvent } from './event-mapping.js';

function fakeTimestamp(dateString) {
  const date = new Date(dateString);
  return { toDate: () => date };
}

function fakeDoc(id, data) {
  return { id, data: () => data };
}

describe('docToEvent', () => {
  it('maps a single-day Firestore event doc into a SiteEvent', () => {
    const event = docToEvent(
      fakeDoc('abc', {
        title: 'Mezcala',
        description: '9a - 2p',
        location: '6901 Orange Ave, Long Beach, CA',
        eventDate: fakeTimestamp('2026-08-22'),
        isActive: true,
      })
    );

    expect(event).toEqual({
      id: 'abc',
      title: 'Mezcala',
      description: '9a - 2p',
      link: null,
      linkLabel: null,
      location: '6901 Orange Ave, Long Beach, CA',
      imageUrl: null,
      startDate: new Date('2026-08-22'),
      endDate: new Date('2026-08-22'),
    });
  });

  it('uses the explicit endDate for a multi-day event instead of collapsing to eventDate', () => {
    const event = docToEvent(
      fakeDoc('artwalk', {
        title: 'Pasadena Artwalk',
        eventDate: fakeTimestamp('2026-09-19'),
        endDate: fakeTimestamp('2026-09-20'),
        isActive: true,
      })
    );

    expect(event.startDate).toEqual(new Date('2026-09-19'));
    expect(event.endDate).toEqual(new Date('2026-09-20'));
  });

  it('falls back endDate to startDate when no endDate field is present', () => {
    const event = docToEvent(fakeDoc('abc', { title: 'One Day', eventDate: fakeTimestamp('2026-09-06') }));

    expect(event.endDate).toEqual(event.startDate);
  });

  it('defaults description/location to null instead of an empty string', () => {
    const event = docToEvent(fakeDoc('abc', { title: 'Bare Event', eventDate: fakeTimestamp('2026-09-06') }));

    expect(event.description).toBeNull();
    expect(event.location).toBeNull();
  });

  it('treats a missing/invalid eventDate as no startDate rather than throwing', () => {
    const event = docToEvent(fakeDoc('abc', { title: 'Broken' }));

    expect(event.startDate).toBeNull();
    expect(event.endDate).toBeNull();
  });

  it('maps a valid http(s) link from Firestore', () => {
    const event = docToEvent(
      fakeDoc('abc', {
        title: 'Mezcala',
        eventDate: fakeTimestamp('2026-08-22'),
        link: 'https://example.com/mezcala-market',
      })
    );

    expect(event.link).toBe('https://example.com/mezcala-market');
  });

  it('rejects a non-http(s) link instead of passing it through to the rendered <a href>', () => {
    const event = docToEvent(
      fakeDoc('abc', {
        title: 'Mezcala',
        eventDate: fakeTimestamp('2026-08-22'),
        link: 'javascript:alert(1)',
      })
    );

    expect(event.link).toBeNull();
  });

  it('maps a valid http(s) imageUrl from Firestore', () => {
    const event = docToEvent(
      fakeDoc('abc', {
        title: 'Mezcala',
        eventDate: fakeTimestamp('2026-08-22'),
        imageUrl: 'https://example.com/photo.jpg',
      })
    );

    expect(event.imageUrl).toBe('https://example.com/photo.jpg');
  });

  it('rejects a non-http(s) imageUrl instead of passing it through to the rendered <img src>', () => {
    const event = docToEvent(
      fakeDoc('abc', {
        title: 'Mezcala',
        eventDate: fakeTimestamp('2026-08-22'),
        imageUrl: 'javascript:alert(1)',
      })
    );

    expect(event.imageUrl).toBeNull();
  });
});
