// Pure transform from an order-doc (see lib/orderFromSession.js's shape)
// to Brevo transactional-email template params. No network calls here —
// unit-testable without live infrastructure, same pattern as the other
// lib/ modules.

function formatAddress(address) {
  if (!address) return '';
  const lines = [address.line1, address.line2, address.city].filter(Boolean);
  const stateZip = [address.state, address.postalCode].filter(Boolean).join(' ');
  const tail = [stateZip, address.country].filter(Boolean);
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
    .map((item) => `${item.name} (x${item.qty}) — $${item.amountTotal.toFixed(2)}`)
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
    CUSTOMER_NAME: order.customer.name || '',
    ITEMS: order.items,
    ITEMS_TEXT: formatItemsText(order.items),
    SHIPPING_ADDRESS: formatAddress(order.shippingAddress),
  };
}

module.exports = { orderDataToConfirmationEmailParams };
