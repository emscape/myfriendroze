// Starts a Stripe checkout from the browser: sends the {sku, qty} list to
// /api/checkout and returns the hosted checkout page's url and session id. Only items are
// sent; Stripe's page collects the shopper's details and the server prices
// everything from Firestore. Shared by the cart page and quick order.
//
// The server holds one-of-a-kind pieces while a checkout is open, so the
// last checkout this browser started is remembered and sent as
// replacesSessionId: a shopper who backs out of Stripe and checks out again
// replaces their own checkout instead of being blocked by it.

const GENERAL_ERROR = "Couldn't start checkout. Please try again.";
export const LAST_CHECKOUT_KEY = 'myfriendroze-last-checkout';

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readLastCheckout(storage) {
  try {
    return storage?.getItem(LAST_CHECKOUT_KEY) || null;
  } catch {
    return null;
  }
}

function rememberCheckout(storage, sessionId) {
  try {
    if (sessionId) storage?.setItem(LAST_CHECKOUT_KEY, sessionId);
  } catch {
    // Without it, checking out again waits for the earlier hold to lapse.
  }
}

/**
 * @param {{ sku: string, qty: number }[]} items
 * @param {typeof fetch} [fetchImpl]
 * @param {Pick<Storage, 'getItem' | 'setItem'> | null} [storage]
 * @returns {Promise<{ url: string, sessionId: string | null }>}
 * @throws {Error} with a message suitable to show the shopper
 */
export async function requestCheckout(items, fetchImpl = fetch, storage = defaultStorage()) {
  const replacesSessionId = readLastCheckout(storage);
  let response;
  try {
    response = await fetchImpl('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(replacesSessionId ? { items, replacesSessionId } : { items }),
    });
  } catch {
    throw new Error("Couldn't start checkout. Check your connection and try again.");
  }

  let result = {};
  try {
    result = await response.json();
  } catch {
    // Fall through to the general message.
  }
  if (response.ok && typeof result.url === 'string' && result.url) {
    const sessionId = typeof result.id === 'string' ? result.id : null;
    rememberCheckout(storage, sessionId);
    return { url: result.url, sessionId };
  }
  throw new Error(typeof result.error === 'string' && result.error ? result.error : GENERAL_ERROR);
}
