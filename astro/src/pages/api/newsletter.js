// Newsletter signup API endpoint using ConvertKit
export async function POST({ request }) {
  try {
    const { email } = await request.json();

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

    // ConvertKit API configuration
    const CONVERTKIT_API_KEY = process.env.CONVERTKIT_API_KEY;
    const CONVERTKIT_FORM_ID = process.env.CONVERTKIT_FORM_ID;

    if (!CONVERTKIT_API_KEY || !CONVERTKIT_FORM_ID) {
      console.error('ConvertKit configuration missing');
      return new Response(
        JSON.stringify({ error: 'Newsletter service not configured' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Subscribe to ConvertKit
    const convertKitResponse = await fetch(`https://api.convertkit.com/v3/forms/${CONVERTKIT_FORM_ID}/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: CONVERTKIT_API_KEY,
        email: email.toLowerCase().trim(),
        tags: ['website-signup']
      })
    });

    const convertKitData = await convertKitResponse.json();

    if (convertKitResponse.ok) {
      console.log('New newsletter subscriber:', email);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Successfully subscribed to newsletter!'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      // Handle ConvertKit errors
      let errorMessage = 'Failed to subscribe. Please try again.';

      if (convertKitData.message && convertKitData.message.includes('already subscribed')) {
        errorMessage = 'This email is already subscribed to our newsletter.';
      }

      console.error('ConvertKit error:', convertKitData);

      return new Response(
        JSON.stringify({ error: errorMessage }),
        {
          status: convertKitData.message && convertKitData.message.includes('already subscribed') ? 409 : 500,
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
