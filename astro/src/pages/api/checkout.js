// Proxies to the createCheckoutSession Cloud Function, same
// browser-never-calls-Firebase-directly pattern as api/orders.js and
// api/shipping.js. Unlike api/orders.js, dev mode is NOT faked here — it
// hits the local Firebase emulator instead, so local dev actually
// exercises the real path end-to-end.

import { validateCheckoutRequest } from '../../lib/checkout-validation.js';
import { buildCheckoutSessionUrl } from '../../lib/checkout-session-url.js';

export const prerender = false;

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const validation = validateCheckoutRequest(body);
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = buildCheckoutSessionUrl({
    isDevelopment: import.meta.env.DEV,
    forwardedHost: request.headers.get('x-forwarded-host'),
    host: request.headers.get('host'),
    projectId: import.meta.env.FIREBASE_PROJECT_ID || 'myfriendroze-platform',
    region: import.meta.env.FIREBASE_REGION || 'us-west1',
  });

  try {
    const cloudFunctionResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await cloudFunctionResponse.json();

    return new Response(JSON.stringify(data), {
      status: cloudFunctionResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Checkout session creation error:', error);
    return new Response(JSON.stringify({ error: 'Failed to start checkout. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function GET() {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
}
