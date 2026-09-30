// Starts a Stripe checkout from the browser: sends the {sku, qty} list to
// /api/checkout and returns the hosted checkout page's url. Only items are
// sent; Stripe's page collects the shopper's details and the server prices
// everything from Firestore. Shared by the cart page and quick order.

const GENERAL_ERROR = "Couldn't start checkout. Please try again.";

/**
 * @param {{ sku: string, qty: number }[]} items
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>} the Stripe checkout url
 * @throws {Error} with a message suitable to show the shopper
 */
export async function requestCheckoutUrl(items, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
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
  if (response.ok && typeof result.url === 'string' && result.url) return result.url;
  throw new Error(typeof result.error === 'string' && result.error ? result.error : GENERAL_ERROR);
}
