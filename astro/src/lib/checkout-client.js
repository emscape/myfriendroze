// Starts a Stripe checkout from the browser: sends the {sku, qty} list to
// /api/checkout and returns the hosted checkout page's url and session id. Only items are
// sent; Stripe's page collects the shopper's details and the server prices
// everything from Firestore. Shared by the cart page and quick order.
//
// The server holds one-of-a-kind pieces while a checkout is open and returns
// a replaceToken with each checkout. The latest one is remembered and sent
// back, so a shopper who backs out of Stripe and checks out again replaces
// their own checkout instead of being blocked by it.

const GENERAL_ERROR = "Couldn't start checkout. Please try again.";
export const CHECKOUT_TOKEN_KEY = 'myfriendroze-checkout-token';

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readToken(storage) {
  try {
    return storage?.getItem(CHECKOUT_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

function rememberToken(storage, token) {
  try {
    if (typeof token === 'string' && token) storage?.setItem(CHECKOUT_TOKEN_KEY, token);
  } catch {
    // Without it, checking out again waits for the earlier hold to lapse.
  }
}

/**
 * @param {{ sku: string, qty: number }[]} items
 * @param {typeof fetch} [fetchImpl]
 * @param {Pick<Storage, 'getItem' | 'setItem'> | null} [storage]
 * @param {string | null} [localZip] - a Los Angeles ZIP from the cart, so
 *   checkout offers local pickup (the server checks it)
 * @returns {Promise<{ url: string, sessionId: string | null }>}
 * @throws {Error} with a message suitable to show the shopper
 */
export async function requestCheckout(items, fetchImpl = fetch, storage = defaultStorage(), localZip = null) {
  const replaceToken = readToken(storage);
  const body = { items };
  if (replaceToken) body.replaceToken = replaceToken;
  if (localZip) body.localZip = localZip;
  let response;
  try {
    response = await fetchImpl('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    rememberToken(storage, result.replaceToken);
    return { url: result.url, sessionId: typeof result.id === 'string' ? result.id : null };
  }
  throw new Error(typeof result.error === 'string' && result.error ? result.error : GENERAL_ERROR);
}
