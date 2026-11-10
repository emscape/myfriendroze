// The code from a /reserved/<code> link, which lets this browser buy the
// pieces Roze reserved for its owner. The reserved page remembers it, and
// checkout-client.js sends it with every checkout; the server ignores it
// unless the cart holds reserved pieces (firebase/functions/lib/reservations.js).

export const RESERVATION_CODE_KEY = 'myfriendroze-reservation-code';

// Must match RESERVATION_CODE in firebase/functions/lib/reservations.js.
const RESERVATION_CODE = /^[A-Za-z0-9_-]{16,64}$/;

/** @param {unknown} code */
export function isReservationCode(code) {
  return typeof code === 'string' && RESERVATION_CODE.test(code);
}

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * @param {Pick<Storage, 'getItem'> | null} [storage]
 * @returns {string | null}
 */
export function readReservationCode(storage = defaultStorage()) {
  try {
    const code = storage?.getItem(RESERVATION_CODE_KEY);
    return isReservationCode(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} code
 * @param {Pick<Storage, 'setItem'> | null} [storage]
 */
export function rememberReservationCode(code, storage = defaultStorage()) {
  if (!isReservationCode(code)) return;
  try {
    storage?.setItem(RESERVATION_CODE_KEY, code);
  } catch {
    // Without it, checkout refuses the reserved pieces with a clear message.
  }
}
