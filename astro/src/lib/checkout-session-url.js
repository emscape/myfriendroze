// Where /api/checkout.js (running inside the ssrAstro Cloud Function) sends
// its server-to-server request to start a Stripe Checkout session.
//
// In production this is a same-origin relative-in-spirit URL built from the
// incoming request, hitting a Firebase Hosting rewrite (see firebase.json)
// rather than createCheckoutSession's raw Cloud Functions URL. That's
// deliberate, not cosmetic: the raw Cloud Run URL requires allUsers invoker
// access, which this project's org policy (domain-restricted sharing)
// blocks — see stripe-payment-integration memory. Routing through a
// Hosting rewrite lets Firebase invoke the function with its own internal
// service agent instead, sidestepping that restriction entirely.
//
// Node's fetch() (unlike a browser's) has no notion of "current page
// origin" and can't resolve a bare relative path — hence building a full
// absolute URL rather than just returning '/create-checkout-session-fn'.
//
// forwardedHost, not host: Firebase Hosting's rewrite-to-function proxy
// sets the Host header to the *function's own* internal address (e.g. its
// Cloud Run hostname), not the public domain the browser actually hit —
// confirmed against the Hosting emulator (Host was 127.0.0.1:<functions
// port>; the original 127.0.0.1:<hosting port> only showed up in
// x-forwarded-host). Building the URL from Host would silently point
// checkout back at ssrAstro's own address instead of the real public
// domain, breaking checkout in production while looking fine in code
// review. host is kept only as a fallback for the (currently unused)
// case of this function being invoked directly, bypassing Hosting.
export function buildCheckoutSessionUrl({ isDevelopment, forwardedHost, host, projectId, region }) {
  if (isDevelopment) {
    return `http://127.0.0.1:5001/${projectId}/${region}/createCheckoutSession`;
  }
  return `https://${forwardedHost || host}/create-checkout-session-fn`;
}
