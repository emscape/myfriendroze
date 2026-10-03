// Pure transform from a completed Stripe Checkout Session (+ its line
// items, fetched separately since Stripe doesn't embed them in the webhook
// payload by default) to the Firestore order-doc shape. No Firestore/
// Stripe calls here — unit-testable without live infrastructure, same
// pattern as lib/pricing.js.
//
// Deliberately does not set createdAt/updatedAt — the caller (stripeWebhook.js)
// adds server timestamps at write time, keeping this function pure and
// side-effect-free.

const { isLocalZip } = require('./localArea');

function centsToDollars(cents) {
  return cents / 100;
}

/**
 * @param {object} session - Stripe Checkout Session (expanded or not)
 * @param {Array<{description: string, quantity: number, amount_total: number}>} lineItems
 * @param {{display_name?: string, metadata?: {method?: string}}|null} [shippingRate]
 * @returns {object} Firestore order-doc shape
 */
// The optional "Special requests" field createCheckoutSession adds.
function notesField(session) {
  const field = session.custom_fields?.find((f) => f.key === 'notes');
  return field?.text?.value || null;
}

// Stripe API versions from 2025-03-31 put the collected address under
// collected_information; older ones put it on the session itself.
function shippingDetailsOf(session) {
  return session.collected_information?.shipping_details ?? session.shipping_details ?? null;
}

// The shipping option the shopper chose (lib/shippingOptions.js). Stripe
// gives only the rate's id on the session, so the caller looks the rate up
// and passes it in; without it, the amount is still recorded.
// outsideLocalArea marks a local pickup whose address isn't a Los Angeles
// one (or is missing), for Roze to follow up: the cart only offers pickup
// for an LA ZIP, but Stripe's page takes any address.
function shippingField(session, shippingRate, shippingDetails) {
  if (!session.shipping_cost) {
    return null;
  }
  const method = shippingRate?.metadata?.method ?? null;
  return {
    method,
    label: shippingRate?.display_name ?? null,
    amount: centsToDollars(session.shipping_cost.amount_total),
    outsideLocalArea: method === 'local_pickup' && !isLocalZip(shippingDetails?.address?.postal_code),
  };
}

function sessionToOrderData(session, lineItems, shippingRate = null) {
  const shippingDetails = shippingDetailsOf(session);
  const address = shippingDetails?.address;

  return {
    status: 'paid',
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent,
    customer: {
      email: session.customer_details?.email ?? session.customer_email ?? null,
      // metadata only exists on sessions created before checkout went
      // straight to Stripe; newer ones carry what Stripe collected.
      name:
        session.metadata?.customerName ??
        session.customer_details?.name ??
        shippingDetails?.name ??
        null,
      phone: session.metadata?.customerPhone ?? session.customer_details?.phone ?? null,
    },
    items: lineItems.map((li) => ({
      name: li.description,
      qty: li.quantity,
      amountTotal: centsToDollars(li.amount_total),
    })),
    total: centsToDollars(session.amount_total),
    // Sales tax Stripe Tax added; null when Stripe didn't say.
    tax: Number.isInteger(session.total_details?.amount_tax) ? centsToDollars(session.total_details.amount_tax) : null,
    currency: session.currency,
    shippingAddress: shippingDetails
      ? {
          name: shippingDetails.name ?? null,
          line1: address?.line1 ?? null,
          line2: address?.line2 ?? null,
          city: address?.city ?? null,
          state: address?.state ?? null,
          postalCode: address?.postal_code ?? null,
          country: address?.country ?? null,
        }
      : null,
    notes: session.metadata?.notes ?? notesField(session),
    shipping: shippingField(session, shippingRate, shippingDetails),
  };
}

module.exports = { sessionToOrderData };
