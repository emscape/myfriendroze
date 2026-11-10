import { describe, it, expect } from 'vitest';
import {
  isReservationCode,
  checkReservedPieces,
  readReservation,
  writeReservationSold,
} from './reservations.js';
import { memoryFirestore } from '../test-support/memoryFirestore.mjs';

const CODE = 'Ab3_-xYz0123456789';
const BOWL = { title: 'Blue Bowl', reserved: true };
const VASE = { title: 'Tall Vase', reserved: true };
const MUG = { title: 'Mug' };

describe('isReservationCode', () => {
  it('accepts 16 to 64 URL-safe characters', () => {
    expect(isReservationCode('a'.repeat(16))).toBe(true);
    expect(isReservationCode('A-_9'.repeat(16))).toBe(true);
    expect(isReservationCode(CODE)).toBe(true);
  });

  // Short codes could be guessed; slashes would address another document.
  it('rejects anything else', () => {
    expect(isReservationCode('a'.repeat(15))).toBe(false);
    expect(isReservationCode('a'.repeat(65))).toBe(false);
    expect(isReservationCode(`${'a'.repeat(16)}/x`)).toBe(false);
    expect(isReservationCode(`${'a'.repeat(16)} `)).toBe(false);
    expect(isReservationCode(undefined)).toBe(false);
    expect(isReservationCode(1234567890123456)).toBe(false);
  });
});

describe('checkReservedPieces', () => {
  const catalog = new Map([
    ['bowl', BOWL],
    ['vase', VASE],
    ['mug', MUG],
  ]);
  const withReservation = (productIds) =>
    memoryFirestore({ [`reservations/${CODE}`]: { note: 'Sam from the market', productIds } });

  it('returns null without reading anything when no piece is reserved', async () => {
    const db = memoryFirestore({});
    db.collection = () => {
      throw new Error('should not read Firestore');
    };
    await expect(checkReservedPieces(db, ['mug'], catalog, undefined)).resolves.toBeNull();
  });

  it('returns the code when it covers every reserved piece in the cart', async () => {
    const db = withReservation(['bowl', 'vase', 'other']);
    await expect(checkReservedPieces(db, ['bowl', 'vase', 'mug'], catalog, CODE)).resolves.toBe(CODE);
  });

  it('refuses a reserved piece with no code', async () => {
    const db = withReservation(['bowl']);
    await expect(checkReservedPieces(db, ['bowl'], catalog, undefined)).rejects.toMatchObject({
      code: 'RESERVED_PIECE',
      message: 'Blue Bowl is reserved for another customer.',
    });
  });

  it('refuses a malformed code without reading the reservation', async () => {
    const db = withReservation(['bowl']);
    await expect(checkReservedPieces(db, ['bowl'], catalog, 'short')).rejects.toMatchObject({ code: 'RESERVED_PIECE' });
  });

  it('refuses a code with no reservation', async () => {
    const db = memoryFirestore({});
    await expect(checkReservedPieces(db, ['bowl'], catalog, CODE)).rejects.toMatchObject({ code: 'RESERVED_PIECE' });
  });

  it("refuses a reserved piece that isn't in the code's reservation, naming it", async () => {
    const db = withReservation(['bowl']);
    await expect(checkReservedPieces(db, ['bowl', 'vase'], catalog, CODE)).rejects.toMatchObject({
      code: 'RESERVED_PIECE',
      message: 'Tall Vase is reserved for another customer.',
    });
  });

  it('treats a reservation without a productIds list as covering nothing', async () => {
    const db = memoryFirestore({ [`reservations/${CODE}`]: { note: 'x' } });
    await expect(checkReservedPieces(db, ['bowl'], catalog, CODE)).rejects.toMatchObject({ code: 'RESERVED_PIECE' });
  });
});

describe('readReservation / writeReservationSold', () => {
  async function sell(db, code, soldSkus) {
    await db.runTransaction(async (tx) => {
      const read = await readReservation(tx, db, code);
      writeReservationSold(tx, read, soldSkus);
    });
  }

  it('removes the bought pieces and keeps the rest of the reservation', async () => {
    const db = memoryFirestore({ [`reservations/${CODE}`]: { note: 'Sam', productIds: ['bowl', 'vase', 'cup'] } });
    await sell(db, CODE, ['bowl', 'mug', 'cup']);
    expect(db.dump(`reservations/${CODE}`)).toEqual({ note: 'Sam', productIds: ['vase'] });
  });

  it('deletes the reservation once every piece is bought', async () => {
    const db = memoryFirestore({ [`reservations/${CODE}`]: { note: 'Sam', productIds: ['bowl', 'vase'] } });
    await sell(db, CODE, ['vase', 'bowl']);
    expect(db.has(`reservations/${CODE}`)).toBe(false);
  });

  it('does nothing for a missing reservation or no code', async () => {
    const db = memoryFirestore({ 'reservations/other-code-123456': { productIds: ['bowl'] } });
    await sell(db, CODE, ['bowl']);
    await sell(db, null, ['bowl']);
    await sell(db, 'bad/code', ['bowl']);
    expect(db.dump('reservations/other-code-123456')).toEqual({ productIds: ['bowl'] });
  });

  it('leaves a reservation without a productIds list alone', async () => {
    const db = memoryFirestore({ [`reservations/${CODE}`]: { note: 'Sam' } });
    await sell(db, CODE, ['bowl']);
    expect(db.dump(`reservations/${CODE}`)).toEqual({ note: 'Sam' });
  });

  it('leaves a reservation untouched when none of its pieces were bought', async () => {
    const db = memoryFirestore({ [`reservations/${CODE}`]: { note: 'Sam', updated: 1, productIds: ['bowl'] } });
    await sell(db, CODE, ['mug']);
    expect(db.dump(`reservations/${CODE}`)).toEqual({ note: 'Sam', updated: 1, productIds: ['bowl'] });
  });
});
