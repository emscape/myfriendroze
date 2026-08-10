import { describe, it, expect } from 'vitest';
import { docToGalleryPhoto } from './fetch-gallery.mjs';

function fakeDoc(id, data) {
  return { id, data: () => data };
}

describe('docToGalleryPhoto', () => {
  it('maps imageUrl to src and altText to alt', () => {
    const doc = fakeDoc('abc123', {
      imageUrl: 'https://example.com/photo.jpg',
      altText: 'Blue ceramic planter',
    });

    const photo = docToGalleryPhoto(doc);

    expect(photo.src).toBe('https://example.com/photo.jpg');
    expect(photo.alt).toBe('Blue ceramic planter');
  });

  it('carries caption and link through when present', () => {
    const doc = fakeDoc('abc123', {
      imageUrl: 'https://example.com/photo.jpg',
      altText: 'Yellow lined planter',
      caption: 'Fresh off the wheel',
      link: 'https://instagram.com/p/xyz',
    });

    const photo = docToGalleryPhoto(doc);

    expect(photo.caption).toBe('Fresh off the wheel');
    expect(photo.link).toBe('https://instagram.com/p/xyz');
  });

  it('defaults caption and link to null (not undefined) when absent', () => {
    const doc = fakeDoc('abc123', {
      imageUrl: 'https://example.com/photo.jpg',
      altText: 'Pineapple planter',
    });

    const photo = docToGalleryPhoto(doc);

    expect(photo.caption).toBeNull();
    expect(photo.link).toBeNull();
    // Explicitly not undefined, since JSON.stringify drops undefined keys
    // and the generated file needs a stable shape.
    expect('caption' in photo).toBe(true);
    expect('link' in photo).toBe(true);
  });

  it('defaults alt to an empty string, never null or undefined', () => {
    const doc = fakeDoc('abc123', {
      imageUrl: 'https://example.com/photo.jpg',
    });

    const photo = docToGalleryPhoto(doc);

    expect(photo.alt).toBe('');
  });

  it('sources id from doc.id, not from the document data', () => {
    const doc = fakeDoc('the-real-id', {
      id: 'a-decoy-id-in-the-data',
      imageUrl: 'https://example.com/photo.jpg',
      altText: 'Decoy test',
    });

    const photo = docToGalleryPhoto(doc);

    expect(photo.id).toBe('the-real-id');
  });
});
