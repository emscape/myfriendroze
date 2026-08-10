// Newsletter signup API endpoint using Firebase Functions
export async function POST({ request }) {
  try {
    const { email, firstName, lastName } = await request.json();

    // Validate email
    if (!email || !isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: 'Valid email address is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Prepare subscription data according to OpenAPI contract
    const subscriptionData = {
      email: email.toLowerCase().trim(),
      source: 'website',
      preferences: {
        newsletter: true,
        promotions: false,
        productUpdates: false
      },
      tags: ['website-signup']
    };

    // Add optional fields if provided
    if (firstName && firstName.trim()) {
      subscriptionData.firstName = firstName.trim();
    }
    if (lastName && lastName.trim()) {
      subscriptionData.lastName = lastName.trim();
    }

    // Call Firebase Functions API for subscription
    // In development, we'll use the MCP bridge for testing
    // In production, we'll call Firebase Functions directly
    const isDevelopment = import.meta.env.DEV;

    let apiResponse;

    if (isDevelopment) {
      // For development, we would use the MCP bridge, but since we can't access it directly
      // from the Astro API route, we'll simulate the call for now
      console.log('Development mode: Would call Firebase Functions via MCP bridge');
      console.log('Subscription data:', subscriptionData);

      // Simulate successful response for development
      apiResponse = {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'dev-' + Date.now(),
          email: subscriptionData.email,
          status: 'active',
          createdAt: new Date().toISOString()
        })
      };
    } else {
      // Production: Call Firebase Functions directly
      const FIREBASE_PROJECT_ID = import.meta.env.FIREBASE_PROJECT_ID || 'myfriendroze-platform';
      const FIREBASE_REGION = import.meta.env.FIREBASE_REGION || 'us-west1';

      apiResponse = await fetch(`https://${FIREBASE_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net/createSubscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscriptionData)
      });
    }

    const responseData = await apiResponse.json();

    if (apiResponse.ok) {
      console.log('New newsletter subscriber:', email);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Successfully subscribed to newsletter!',
          data: responseData
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      // Handle API errors
      let errorMessage = 'Failed to subscribe. Please try again.';

      if (responseData.error && responseData.error.includes('already subscribed')) {
        errorMessage = 'This email is already subscribed to our newsletter.';
      } else if (responseData.message) {
        errorMessage = responseData.message;
      }

      console.error('Firebase Functions API error:', responseData);

      return new Response(
        JSON.stringify({ error: errorMessage }),
        {
          status: apiResponse.status,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

  } catch (error) {
    console.error('Newsletter signup error:', error);

    return new Response(
      JSON.stringify({ error: 'Failed to subscribe. Please try again.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Email validation function
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Handle non-POST requests
export async function GET() {
  return new Response(
    JSON.stringify({ error: 'Method not allowed' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
