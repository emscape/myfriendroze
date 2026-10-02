import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { memoryFirestore } from '../test-support/memoryFirestore.mjs';

// createRequire, not a static import — see vitest.config.js.
const require = createRequire(import.meta.url);
const {
  isOneOfAKind,
  readHolds,
  checkHolds,
  reservePieces,
  releaseHolds,
  holdForPendingPayment,
  hashToken,
  readSessionHolds,
  writePiecesSold,
  CHECKOUT_LIFETIME_SECONDS,
  HOLD_GRACE_MS,
  PENDING_PAYMENT_HOLD_MS,
} = require('./checkoutHolds.js');
const { CatalogValidationError } = require('./pricing.js');

const NOW = 1_800_000_000_000;
const BOWL = { title: 'Blue Bowl', price: 40, isActive: true, category: 'pottery' };
const VASE = { title: 'Tall Vase', price: 90, isActive: true, category: 'other' };
const FERN = { title: 'Fern', price: 12, isActive: true, category: 'plant' };
const catalog = new Map([
  ['bowl', BOWL],
  ['vase', VASE],
  ['fern', FERN],
]);

function rejection(promiseOrFn) {
  return Promise.resolve()
    .then(promiseOrFn)
    .then(
      () => {
        throw new Error('expected a rejection');
      },
      (err) => err
    );
}

describe('lifetimes', () => {
  // Stripe refuses an expires_at under 30 minutes after creation; one
  // minute of margin covers the time between computing it and Stripe
  // receiving the request.
  it('asks Stripe for a 31-minute checkout and keeps holds 5 minutes past it', () => {
    expect(CHECKOUT_LIFETIME_SECONDS).toBe(31 * 60);
    expect(HOLD_GRACE_MS).toBe(5 * 60 * 1000);
  });

  // Bank debits can take several business days to settle.
  it('keeps a hold 14 days for a payment still settling', () => {
    expect(PENDING_PAYMENT_HOLD_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

describe('isOneOfAKind', () => {
  it('is true for pottery, other and an uncategorised piece, false for plants', () => {
    expect(isOneOfAKind(BOWL)).toBe(true);
    expect(isOneOfAKind(VASE)).toBe(true);
    expect(isOneOfAKind({ title: 'x' })).toBe(true);
    expect(isOneOfAKind(FERN)).toBe(false);
  });
});

describe('readHolds', () => {
  it('returns the hold for each sku that has one, keyed by sku', async () => {
    const db = memoryFirestore({
      'checkoutHolds/bowl': { sessionId: 'cs_a', heldUntil: NOW + 1000 },
    });
    const holds = await readHolds(db, ['bowl', 'vase']);
    expect([...holds.entries()]).toEqual([['bowl', { sessionId: 'cs_a', heldUntil: NOW + 1000 }]]);
  });
});

function thrown(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

describe('hashToken', () => {
  it('is the hex SHA-256 of the token', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

// A hold belongs to the shopper who started its checkout: the server gave
// them a random token and keeps only its hash on the hold. The Stripe
// session id is not proof, since it appears in the checkout page's URL.
describe('checkHolds', () => {
  const MINE = hashToken('my-token');

  it('passes when no piece is held, and reports no replaced checkout', () => {
    expect(checkHolds(new Map(), catalog, { now: NOW, replaceTokenHash: null })).toBeNull();
  });

  it('refuses a piece another checkout is holding, naming it and when it may free up', () => {
    const holds = new Map([['bowl', { sessionId: 'cs_other', heldUntil: NOW + 1, tokenHash: 'theirs' }]]);
    const err = thrown(() => checkHolds(holds, catalog, { now: NOW, replaceTokenHash: MINE }));
    expect(err).toBeInstanceOf(CatalogValidationError);
    expect(err.code).toBe('RESERVED');
    expect(err.message).toBe(
      "Someone is checking out Blue Bowl right now. If they don't finish, it'll be available again in about half an hour."
    );
  });

  it('refuses a piece held for a payment that is still settling, saying so', () => {
    const holds = new Map([['bowl', { sessionId: 'cs_other', heldUntil: NOW + 1, pendingPayment: true }]]);
    const err = thrown(() => checkHolds(holds, catalog, { now: NOW, replaceTokenHash: null }));
    expect(err.code).toBe('PAYMENT_PENDING');
    expect(err.message).toBe(
      "A payment for Blue Bowl is being processed. If it doesn't go through, it'll be available again."
    );
  });

  it('treats a hold whose time has passed as free', () => {
    const holds = new Map([['bowl', { sessionId: 'cs_other', heldUntil: NOW, tokenHash: 'theirs' }]]);
    expect(checkHolds(holds, catalog, { now: NOW, replaceTokenHash: null })).toBeNull();
  });

  it("returns the session of the shopper's own earlier checkout, matched by token", () => {
    const holds = new Map([['bowl', { sessionId: 'cs_mine', heldUntil: NOW + 1, tokenHash: MINE }]]);
    expect(checkHolds(holds, catalog, { now: NOW, replaceTokenHash: MINE })).toBe('cs_mine');
  });

  it('never treats a hold without a token as the shopper\'s own', () => {
    const holds = new Map([['bowl', { sessionId: 'cs_old', heldUntil: NOW + 1 }]]);
    expect(thrown(() => checkHolds(holds, catalog, { now: NOW, replaceTokenHash: null })).code).toBe('RESERVED');
  });

  it('reports no replaced checkout when its holds have all lapsed', () => {
    const holds = new Map([['bowl', { sessionId: 'cs_mine', heldUntil: NOW - 1, tokenHash: MINE }]]);
    expect(checkHolds(holds, catalog, { now: NOW, replaceTokenHash: MINE })).toBeNull();
  });
});

describe('reservePieces', () => {
  const base = {
    sessionId: 'cs_new',
    heldUntil: NOW + 36 * 60 * 1000,
    tokenHash: 'new-hash',
    now: NOW,
    replaceTokenHash: null,
    catalog,
  };
  const newHold = { sessionId: 'cs_new', heldUntil: base.heldUntil, tokenHash: 'new-hash' };

  it('writes a hold for every piece', async () => {
    const db = memoryFirestore({ 'products/bowl': BOWL, 'products/vase': VASE });
    await reservePieces(db, { ...base, skus: ['bowl', 'vase'] });
    expect(db.dump('checkoutHolds/bowl')).toEqual(newHold);
    expect(db.dump('checkoutHolds/vase')).toEqual(newHold);
  });

  it('writes nothing if any piece is held by another checkout', async () => {
    const theirs = { sessionId: 'cs_other', heldUntil: NOW + 1, tokenHash: 'theirs' };
    const db = memoryFirestore({
      'products/bowl': BOWL,
      'products/vase': VASE,
      'checkoutHolds/vase': theirs,
    });
    const err = await rejection(() => reservePieces(db, { ...base, skus: ['bowl', 'vase'] }));
    expect(err.code).toBe('RESERVED');
    expect(err.message).toContain('Tall Vase');
    expect(db.has('checkoutHolds/bowl')).toBe(false);
    expect(db.dump('checkoutHolds/vase')).toEqual(theirs);
  });

  // The piece can sell (another checkout's webhook) between the handler's
  // first read and this transaction.
  it('refuses a piece that sold since the catalog was read', async () => {
    const db = memoryFirestore({ 'products/bowl': { ...BOWL, inStock: false } });
    const err = await rejection(() => reservePieces(db, { ...base, skus: ['bowl'] }));
    expect(err).toBeInstanceOf(CatalogValidationError);
    expect(err.code).toBe('OUT_OF_STOCK');
    expect(err.message).toBe('Blue Bowl has just sold.');
    expect(db.has('checkoutHolds/bowl')).toBe(false);
  });

  it('refuses a piece deleted since the catalog was read', async () => {
    const db = memoryFirestore({});
    const err = await rejection(() => reservePieces(db, { ...base, skus: ['bowl'] }));
    expect(err.code).toBe('OUT_OF_STOCK');
  });

  it("takes over the shopper's own earlier hold", async () => {
    const db = memoryFirestore({
      'products/bowl': BOWL,
      'checkoutHolds/bowl': { sessionId: 'cs_mine', heldUntil: NOW + 1, tokenHash: 'mine' },
    });
    await reservePieces(db, { ...base, skus: ['bowl'], replaceTokenHash: 'mine' });
    expect(db.dump('checkoutHolds/bowl')).toEqual(newHold);
  });
});

describe('releaseHolds', () => {
  it("deletes only the given checkout's holds", async () => {
    const db = memoryFirestore({
      'checkoutHolds/bowl': { sessionId: 'cs_gone', heldUntil: NOW + 1 },
      'checkoutHolds/vase': { sessionId: 'cs_gone', heldUntil: NOW + 1 },
      'checkoutHolds/jug': { sessionId: 'cs_other', heldUntil: NOW + 1 },
    });
    await releaseHolds(db, 'cs_gone');
    expect(db.has('checkoutHolds/bowl')).toBe(false);
    expect(db.has('checkoutHolds/vase')).toBe(false);
    expect(db.dump('checkoutHolds/jug')).toEqual({ sessionId: 'cs_other', heldUntil: NOW + 1 });
  });
});

describe('holdForPendingPayment', () => {
  it("extends only the given checkout's holds and marks them as awaiting payment", async () => {
    const db = memoryFirestore({
      'checkoutHolds/bowl': { sessionId: 'cs_pending', heldUntil: NOW + 1, tokenHash: 'h' },
      'checkoutHolds/jug': { sessionId: 'cs_other', heldUntil: NOW + 1 },
    });
    await holdForPendingPayment(db, 'cs_pending', NOW + 999);
    expect(db.dump('checkoutHolds/bowl')).toEqual({
      sessionId: 'cs_pending',
      heldUntil: NOW + 999,
      tokenHash: 'h',
      pendingPayment: true,
    });
    expect(db.dump('checkoutHolds/jug')).toEqual({ sessionId: 'cs_other', heldUntil: NOW + 1 });
  });
});

describe('readSessionHolds + writePiecesSold', () => {
  it("marks the checkout's pieces sold and deletes its holds, leaving other pieces alone", async () => {
    const db = memoryFirestore({
      'products/bowl': BOWL,
      'products/vase': { ...VASE, inStock: true },
      'products/jug': { title: 'Jug', isActive: true },
      'checkoutHolds/bowl': { sessionId: 'cs_paid', heldUntil: NOW + 1 },
      'checkoutHolds/vase': { sessionId: 'cs_paid', heldUntil: NOW + 1 },
      'checkoutHolds/jug': { sessionId: 'cs_other', heldUntil: NOW + 1 },
    });
    await db.runTransaction(async (tx) => {
      const read = await readSessionHolds(tx, db, 'cs_paid');
      writePiecesSold(tx, read);
    });
    expect(db.dump('products/bowl')).toEqual({ ...BOWL, inStock: false });
    expect(db.dump('products/vase')).toEqual({ ...VASE, inStock: false });
    expect(db.dump('products/jug')).toEqual({ title: 'Jug', isActive: true });
    expect(db.has('checkoutHolds/bowl')).toBe(false);
    expect(db.has('checkoutHolds/vase')).toBe(false);
    expect(db.has('checkoutHolds/jug')).toBe(true);
  });

  // A piece deleted in the admin app mid-checkout must not make the
  // webhook fail (Stripe would retry it forever) or recreate the product.
  it('skips a held piece whose product was deleted, still deleting the hold', async () => {
    const db = memoryFirestore({
      'checkoutHolds/bowl': { sessionId: 'cs_paid', heldUntil: NOW + 1 },
    });
    await db.runTransaction(async (tx) => {
      writePiecesSold(tx, await readSessionHolds(tx, db, 'cs_paid'));
    });
    expect(db.has('products/bowl')).toBe(false);
    expect(db.has('checkoutHolds/bowl')).toBe(false);
  });
});
