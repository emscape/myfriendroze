import { describe, it, expect, vi } from 'vitest';
import {
  isReservationCode,
  readReservationCode,
  rememberReservationCode,
  RESERVATION_CODE_KEY,
} from './reservation-code.js';

const CODE = 'Ab3_-xYz0123456789';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
  };
}

// Must match firebase/functions/lib/reservations.js.
describe('isReservationCode', () => {
  it('accepts 16 to 64 URL-safe characters and nothing else', () => {
    expect(isReservationCode(CODE)).toBe(true);
    expect(isReservationCode('a'.repeat(64))).toBe(true);
    expect(isReservationCode('a'.repeat(15))).toBe(false);
    expect(isReservationCode('a'.repeat(65))).toBe(false);
    expect(isReservationCode(`${'a'.repeat(16)}/x`)).toBe(false);
    expect(isReservationCode(undefined)).toBe(false);
  });
});

describe('rememberReservationCode / readReservationCode', () => {
  it('reads back the code it remembered', () => {
    const storage = memoryStorage();
    rememberReservationCode(CODE, storage);
    expect(readReservationCode(storage)).toBe(CODE);
  });

  it('never stores or returns something that is not a code', () => {
    const storage = memoryStorage({ [RESERVATION_CODE_KEY]: 'short' });
    expect(readReservationCode(storage)).toBeNull();
    const setItem = vi.fn();
    rememberReservationCode('../x', { getItem: () => null, setItem });
    expect(setItem).not.toHaveBeenCalled();
  });

  // Private windows and blocked site storage throw on access.
  it('copes with missing or throwing storage', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readReservationCode(null)).toBeNull();
    expect(readReservationCode(throwing)).toBeNull();
    expect(() => rememberReservationCode(CODE, throwing)).not.toThrow();
    expect(() => rememberReservationCode(CODE, null)).not.toThrow();
  });
});
