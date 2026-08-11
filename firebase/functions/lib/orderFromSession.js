// Pure transform from a completed Stripe Checkout Session (+ its line
// items, fetched separately since Stripe doesn't embed them in the webhook
// payload by default) to the Firestore order-doc shape. No Firestore/
// Stripe calls here — unit-testable without live infrastructure, same
// pattern as lib/pricing.js.
//
// Deliberately does not set createdAt/updatedAt — the caller (stripeWebhook.js)
// adds server timestamps at write time, keeping this function pure and
// side-effect-free.

function centsToDollars(cents) {
  return cents / 100;
}

/**
 * @param {object} session - Stripe Checkout Session (expanded or not)
 * @param {Array<{description: string, quantity: number, amount_total: number}>} lineItems
 * @returns {object} Firestore order-doc shape
 */
function sessionToOrderData(session, lineItems) {
  const address = session.shipping_details?.address;

  return {
    status: 'paid',
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent,
    customer: {
      email: session.customer_details?.email ?? session.customer_email ?? null,
      name: session.metadata?.customerName ?? null,
      phone: session.metadata?.customerPhone ?? null,
    },
    items: lineItems.map((li) => ({
      name: li.description,
      qty: li.quantity,
      amountTotal: centsToDollars(li.amount_total),
    })),
    total: centsToDollars(session.amount_total),
    currency: session.currency,
    shippingAddress: session.shipping_details
      ? {
          name: session.shipping_details.name ?? null,
          line1: address?.line1 ?? null,
          line2: address?.line2 ?? null,
          city: address?.city ?? null,
          state: address?.state ?? null,
          postalCode: address?.postal_code ?? null,
          country: address?.country ?? null,
        }
      : null,
    notes: session.metadata?.notes ?? null,
  };
}

module.exports = { sessionToOrderData };
