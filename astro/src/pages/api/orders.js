// Orders API endpoint using Firebase Functions
export async function POST({ request }) {
  try {
    const orderData = await request.json();

    // Validate required fields
    if (!orderData.customer || !orderData.items || orderData.total === undefined) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: customer, items, and total are required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate customer data
    if (!orderData.customer.email || !orderData.customer.name) {
      return new Response(
        JSON.stringify({ error: 'Customer email and name are required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(orderData.customer.email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate items array
    if (!Array.isArray(orderData.items) || orderData.items.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Items array is required and must not be empty' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate each item
    for (const item of orderData.items) {
      if (!item.sku || !item.name || !item.qty || item.price === undefined) {
        return new Response(
          JSON.stringify({ error: 'Each item must have sku, name, qty, and price' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Call Firebase Functions API for order creation
    const isDevelopment = import.meta.env.DEV;
    
    let apiResponse;
    
    if (isDevelopment) {
      // For development, we would use the MCP bridge for testing
      // In production, we'll call Firebase Functions directly
      console.log('Development mode: Would call Firebase Functions via MCP bridge');
      console.log('Order data:', orderData);
      
      // Simulate successful response for development
      apiResponse = {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'dev-order-' + Date.now(),
          status: 'pending',
          createdAt: new Date().toISOString(),
          total: orderData.total
        })
      };
    } else {
      // Production: Call Firebase Functions directly
      const FIREBASE_PROJECT_ID = import.meta.env.FIREBASE_PROJECT_ID || 'myfriendroze-platform';
      const FIREBASE_REGION = import.meta.env.FIREBASE_REGION || 'us-west1';
      
      apiResponse = await fetch(`https://${FIREBASE_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net/createOrder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderData)
      });
    }

    const responseData = await apiResponse.json();

    if (apiResponse.ok) {
      console.log('New order created:', {
        orderId: responseData.id,
        customer: orderData.customer.email,
        total: orderData.total
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Order created successfully!',
          data: responseData
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      // Handle API errors
      let errorMessage = 'Failed to create order. Please try again.';

      if (responseData.error) {
        errorMessage = responseData.error;
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
    console.error('Order creation error:', error);

    return new Response(
      JSON.stringify({ error: 'Failed to create order. Please try again.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
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

export async function PUT() {
  return new Response(
    JSON.stringify({ error: 'Method not allowed' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export async function DELETE() {
  return new Response(
    JSON.stringify({ error: 'Method not allowed' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
