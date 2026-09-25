// USPS Web Tools shipping rate calculation (RateV4 API, same one PirateShip
// uses under the hood) -- testable core lives in shippingEstimate.js.
exports.getShippingEstimate = require('./shippingEstimate').getShippingEstimate;

// Newsletter signup Cloud Function (double opt-in step 1: sends a
// confirmation email, writes nothing to Firestore yet)
exports.newsletterSignup = require('./newsletterSignup').newsletterSignup;

// Newsletter confirmation Cloud Function (double opt-in step 2: verifies
// the signed link, creates the subscriber record, sends the welcome email)
exports.confirmNewsletterSignup = require('./confirmNewsletterSignup').confirmNewsletterSignup;

// Newsletter/preferences unsubscribe Cloud Function -- wired up here so the
// welcome email's unsubscribe links (generated via lib/unsubscribeToken.js)
// actually resolve to something instead of 404ing.
exports.unsubscribe = require('./unsubscribe').unsubscribe;

// Stripe Checkout session creation
exports.createCheckoutSession = require('./createCheckoutSession').createCheckoutSession;

// Stripe webhook — creates the order once payment is actually confirmed
exports.stripeWebhook = require('./stripeWebhook').stripeWebhook;

// Admin-only: resend an order confirmation email
exports.resendOrderConfirmation = require('./orderConfirmation').resendOrderConfirmation;
exports.ssrAstro = require('./ssrAstro').ssrAstro;
