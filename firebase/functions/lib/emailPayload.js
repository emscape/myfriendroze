// Pure transform from an order-doc (see lib/orderFromSession.js's shape)
// to Brevo transactional-email template params. No network calls here —
// unit-testable without live infrastructure, same pattern as the other
// lib/ modules.

const { escapeHtml } = require('./escapeHtml');
const { formatEventDateTime } = require('./eventDateFormat');

function joinAddressParts(address, esc) {
  if (!address) return '';
  const lines = [esc(address.line1), esc(address.line2), esc(address.city)].filter(Boolean);
  const stateZip = [esc(address.state), esc(address.postalCode)].filter(Boolean).join(' ');
  const tail = [stateZip, esc(address.country)].filter(Boolean);
  return [...lines, ...tail].join(', ');
}

// Customer-supplied free text (from Stripe Checkout's address collection)
// gets interpolated as-is into the order-confirmation template body, so it
// must be escaped here before it ever reaches Brevo.
function formatAddress(address) {
  return joinAddressParts(address, (value) => (value ? escapeHtml(value) : value));
}

// Same joining, deliberately unescaped -- for callers (orderShippedEmailParams)
// that apply their own single escaping pass to the whole formatted string.
// Escaping each field individually then joining vs. joining raw fields then
// escaping the whole string produce identical output (escapeHtml only
// touches &<>"', none of which the join's ", " / " " separators introduce),
// so this is safe -- but calling formatAddress a second time on its own
// output double-escapes (e.g. "&" -> "&amp;" -> "&amp;amp;").
function formatAddressRaw(address) {
  return joinAddressParts(address, (value) => value);
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

function shippingLabel(shipping) {
  return escapeHtml(shipping.label || 'Shipping');
}

// Appended to ITEMS_TEXT so the confirmation email shows shipping with the
// template it already has.
function formatShippingLine(shipping) {
  return shipping ? `<br>${shippingLabel(shipping)} — $${shipping.amount.toFixed(2)}` : '';
}

// The order-confirmation template shows SHIPPING_HEADING and SHIPPING_NOTE
// in its shipping section (it has no conditionals), so pickup orders don't
// read as being shipped.
const MAIL_NOTE =
  "We are currently summoning the energy to box it up. You'll get a tracking link once we achieve this miracle — don't worry, miracles occur with more rapidity than you might think.";
const PICKUP_NOTE = "We'll email you to arrange a pickup time in Los Angeles.";

/**
 * @param {ReturnType<typeof import('./orderFromSession.js').sessionToOrderData>} order
 */
function orderDataToConfirmationEmailParams(order) {
  const pickup = order.shipping?.method === 'local_pickup';
  return {
    EMAIL: order.customer.email,
    ORDER_NUMBER: order.stripeSessionId,
    ORDER_TOTAL: `$${order.total.toFixed(2)}`,
    CUSTOMER_NAME: order.customer.name ? escapeHtml(order.customer.name) : '',
    ITEMS: order.items,
    ITEMS_TEXT: formatItemsText(order.items) + formatShippingLine(order.shipping),
    SHIPPING_ADDRESS: pickup ? '' : formatAddress(order.shippingAddress),
    SHIPPING_METHOD: order.shipping ? shippingLabel(order.shipping) : '',
    SHIPPING_HEADING: pickup ? 'Local pickup' : 'Shipping to:',
    SHIPPING_NOTE: pickup ? PICKUP_NOTE : MAIL_NOTE,
  };
}

// Escapes only when truthy -- preserves each field's existing '' / 'N/A'
// fallback instead of turning a missing value into the escaped string
// '' or 'N/A' (a no-op either way, but keeps the fallback logic in one place).
// Coerces to a string first: these are onCall inputs with no type
// validation at the boundary, and escapeHtml's .replace() throws on a
// non-string, e.g. a numeric orderNumber or price.
function esc(value) {
  return value ? escapeHtml(String(value)) : value;
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

// Builds the whole "More info: <link>" line in code (empty when there's no
// link), same reasoning as greeting() below: branching in the template would
// need Brevo conditional syntax, and a fixed label would dangle for the
// many events that have no link.
function moreInfoLine(link) {
  const trimmed = typeof link === 'string' ? link.trim() : '';
  return trimmed ? `More info: ${esc(trimmed)}` : '';
}

// `event` is the real Firestore events/{eventId} doc (see
// eventNotification.js) -- title/description/location/link are Roze's own
// free-text input via the admin app, same trust boundary as
// orderShippedEmailParams above, so every free-text field still gets
// escaped here before it's interpolated unescaped into the Brevo template
// body. eventDate/endDate are Firestore Timestamps; formatEventDateTime's
// output is generated purely from Intl formatters (no user-controlled
// characters can pass through), so it needs no separate escaping.
// subscriberEmail and the unsubscribe URLs come from Firestore/HMAC
// generation, not free text, so they're passed through unescaped too.
function eventNotificationEmailParams(event, subscriberEmail, unsubscribeEvents, unsubscribeAll) {
  const { dateText, timeText } = formatEventDateTime(event.eventDate, event.endDate);
  return {
    EMAIL: subscriberEmail,
    EVENT_TITLE: esc(event.title) || 'Special Event',
    EVENT_DATE: dateText,
    EVENT_TIME: timeText,
    EVENT_LOCATION: esc(event.location) || '',
    EVENT_DESCRIPTION: esc(event.description) || '',
    EVENT_MORE_INFO: moreInfoLine(event.link),
    UNSUBSCRIBE_EVENTS: unsubscribeEvents,
    UNSUBSCRIBE_ALL: unsubscribeAll,
  };
}

// Computes the full greeting string here rather than exposing a raw
// FIRST_NAME param -- same reasoning as order-confirmation.html's own
// comment: Brevo's conditional-tag syntax wasn't confirmed against current
// docs, so branching on "is there a name" happens in code, not in the
// template, to avoid a dangling "Hi ," when firstName is absent.
function greeting(firstName) {
  return typeof firstName === 'string' && firstName.trim()
    ? `Hi ${escapeHtml(firstName.trim())},`
    : 'Hi there,';
}

// firstName is request-controlled (the signup form), same concern as
// orderShippedEmailParams above -- greeting() escapes it. confirmUrl is
// generated by lib/newsletter-signup.js's buildConfirmUrl from a
// server-signed token, not free text, so it's passed through unescaped.
function newsletterConfirmationEmailParams({ email, firstName, confirmUrl }) {
  return {
    EMAIL: email,
    GREETING: greeting(firstName),
    CONFIRM_URL: confirmUrl,
  };
}

// Same firstName-escaping concern; unsubscribeNewsletter/unsubscribeAll are
// HMAC-generated URLs (lib/unsubscribeToken.js), not free text.
function newsletterWelcomeEmailParams({ email, firstName, unsubscribeNewsletter, unsubscribeAll }) {
  return {
    EMAIL: email,
    GREETING: greeting(firstName),
    UNSUBSCRIBE_NEWSLETTER: unsubscribeNewsletter,
    UNSUBSCRIBE_ALL: unsubscribeAll,
  };
}

module.exports = {
  orderDataToConfirmationEmailParams,
  orderShippedEmailParams,
  eventNotificationEmailParams,
  newsletterConfirmationEmailParams,
  newsletterWelcomeEmailParams,
  formatAddress,
  formatAddressRaw,
};
