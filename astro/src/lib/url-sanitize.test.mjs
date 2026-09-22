import { describe, it, expect } from 'vitest';
import { sanitizeHttpUrl } from './url-sanitize.js';

describe('sanitizeHttpUrl', () => {
  it('passes through a valid http URL', () => {
    expect(sanitizeHttpUrl('http://example.com', null)).toBe('http://example.com');
  });

  it('passes through a valid https URL', () => {
    expect(sanitizeHttpUrl('https://example.com/page', null)).toBe('https://example.com/page');
  });

  it('rejects a javascript: URL', () => {
    expect(sanitizeHttpUrl('javascript:alert(1)', null)).toBeNull();
  });

  it('rejects a data: URL', () => {
    expect(sanitizeHttpUrl('data:text/html,<script>alert(1)</script>', null)).toBeNull();
  });

  it('rejects a non-string value instead of coercing it', () => {
    expect(sanitizeHttpUrl(12345, null)).toBeNull();
  });

  it('returns the given fallback for an invalid value, not always null', () => {
    expect(sanitizeHttpUrl('not-a-url', '')).toBe('');
  });

  it('rejects undefined/missing values', () => {
    expect(sanitizeHttpUrl(undefined, null)).toBeNull();
  });
});
