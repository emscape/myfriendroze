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
    SHIPPING_ADDRESS: formatAddress(order.shippingAddress),
  };
}

module.exports = { orderDataToConfirmationEmailParams };
