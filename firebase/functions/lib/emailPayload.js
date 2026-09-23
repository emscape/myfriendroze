// Pure transform from an order-doc (see lib/orderFromSession.js's shape)
// to Brevo transactional-email template params. No network calls here —
// unit-testable without live infrastructure, same pattern as the other
// lib/ modules.

const { escapeHtml } = require('./escapeHtml');

// Customer-supplied free text (from Stripe Checkout's address collection)
// gets interpolated as-is into the order-confirmation template body, so it
// must be escaped here before it ever reaches Brevo.
function formatAddress(address) {
  if (!address) return '';
  const esc = (value) => (value ? escapeHtml(value) : value);
  const lines = [esc(address.line1), esc(address.line2), esc(address.city)].filter(Boolean);
  const stateZip = [esc(address.state), esc(address.postalCode)].filter(Boolean).join(' ');
  const tail = [stateZip, esc(address.country)].filter(Boolean);
  return [...lines, ...tail].join(', ');
}

// Pre-formatted for direct interpolation into the Brevo template body
// (`{{ params.ITEMS_TEXT }}`) rather than requiring template-side looping
// syntax over ITEMS — keeps the tricky formatting logic here, where it's
// unit-tested, instead of in Brevo's editor. <br> not \n: params get
// substituted into already-built HTML, and a raw newline collapses to a
// space in HTML rendering — it needs a real line-break tag to show up.
function formatItemsText(items) {
  return items
    .map((item) => `${escapeHtml(item.name)} (x${item.qty}) — $${item.amountTotal.toFixed(2)}`)
    .join('<br>');
}

/**
 * @param {ReturnType<typeof import('./orderFromSession.js').sessionToOrderData>} order
 */
function orderDataToConfirmationEmailParams(order) {
  return {
    EMAIL: order.customer.email,
    ORDER_NUMBER: order.stripeSessionId,
    ORDER_TOTAL: `$${order.total.toFixed(2)}`,
    CUSTOMER_NAME: order.customer.name ? escapeHtml(order.customer.name) : '',
    ITEMS: order.items,
    ITEMS_TEXT: formatItemsText(order.items),
    SHIPPING_ADDRESS: formatAddress(order.shippingAddress),
  };
}

// Escapes only when truthy -- preserves each field's existing '' / 'N/A'
// fallback instead of turning a missing value into the escaped string
// '' or 'N/A' (a no-op either way, but keeps the fallback logic in one place).
function esc(value) {
  return value ? escapeHtml(value) : value;
}

// orderDetails/shippingDetails are supplied directly by the caller (the
// admin app, via onCall), not derived from a Stripe-validated session like
// orderDataToConfirmationEmailParams's `order` is -- every free-text field
// here gets interpolated unescaped into the Brevo template body otherwise.
function orderShippedEmailParams(email, orderDetails, shippingDetails) {
  return {
    EMAIL: email,
    ORDER_NUMBER: esc(orderDetails.orderNumber) || 'N/A',
    CUSTOMER_NAME: esc(orderDetails.customerName) || '',
    TRACKING_NUMBER: esc(shippingDetails.trackingNumber) || '',
    CARRIER: esc(shippingDetails.carrier) || '',
    TRACKING_URL: esc(shippingDetails.trackingUrl) || '',
    ESTIMATED_DELIVERY: esc(shippingDetails.estimatedDelivery) || '',
    SHIPPING_ADDRESS: esc(orderDetails.shippingAddress) || '',
  };
}

// eventDetails is caller-supplied (onCall), same concern as
// orderShippedEmailParams above. subscriberEmail and the unsubscribe URLs
// come from Firestore/HMAC generation, not free text, so they're passed
// through unescaped.
function eventNotificationEmailParams(eventDetails, subscriberEmail, unsubscribeEvents, unsubscribeAll) {
  return {
    EMAIL: subscriberEmail,
    EVENT_TITLE: esc(eventDetails.title) || 'Special Event',
    EVENT_DATE: esc(eventDetails.date) || '',
    EVENT_TIME: esc(eventDetails.time) || '',
    EVENT_LOCATION: esc(eventDetails.location) || '',
    EVENT_DESCRIPTION: esc(eventDetails.description) || '',
    EVENT_PRICE: esc(eventDetails.price) || '',
    REGISTRATION_URL: esc(eventDetails.registrationUrl) || '',
    UNSUBSCRIBE_EVENTS: unsubscribeEvents,
    UNSUBSCRIBE_ALL: unsubscribeAll,
  };
}

module.exports = {
  orderDataToConfirmationEmailParams,
  orderShippedEmailParams,
  eventNotificationEmailParams,
};
