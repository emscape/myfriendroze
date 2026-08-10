// Simple test script to verify Firebase Functions are working
const admin = require('firebase-admin');

// Initialize Firebase Admin (for testing locally)
if (!admin.apps.length) {
  admin.initializeApp();
}

async function testFunctions() {
  console.log('🧪 Testing Firebase Functions...\n');

  try {
    // Test 1: Health Check
    console.log('1. Testing healthz function...');
    const { healthz } = require('./healthz');
    
    // Mock request object for callable function
    const healthRequest = { data: {}, auth: null };
    const healthResult = await healthz.handler(healthRequest);
    
    console.log('✅ Health check result:', healthResult);
    console.log('');

    // Test 2: Create Subscription (no auth required)
    console.log('2. Testing createSubscription function...');
    const { createSubscription } = require('./subscribe');
    
    const subscriptionRequest = {
      data: {
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        preferences: {
          newsletter: true,
          promotions: false,
          productUpdates: true
        },
        source: 'website',
        tags: ['test']
      },
      auth: null // No authentication
    };
    
    try {
      const subscriptionResult = await createSubscription.handler(subscriptionRequest);
      console.log('✅ Subscription result:', subscriptionResult);
    } catch (error) {
      if (error.code === 'already-exists') {
        console.log('✅ Subscription validation working (email already exists)');
      } else {
        console.log('❌ Subscription error:', error.message);
      }
    }
    console.log('');

    // Test 3: Create Order (auth required)
    console.log('3. Testing createOrder function...');
    const { createOrder } = require('./orders');
    
    // Test without auth (should fail)
    const orderRequestNoAuth = {
      data: {
        customer: { email: 'test@example.com', name: 'Test Customer' },
        items: [{ sku: 'test-sku', name: 'Test Item', qty: 1, price: 10.0 }],
        total: 10.0
      },
      auth: null
    };
    
    try {
      await createOrder.handler(orderRequestNoAuth);
      console.log('❌ Order should have failed without auth');
    } catch (error) {
      if (error.code === 'unauthenticated') {
        console.log('✅ Order authentication working (rejected unauthenticated request)');
      } else {
        console.log('❌ Unexpected order error:', error.message);
      }
    }

    // Test with mock auth (should work)
    const orderRequestWithAuth = {
      data: {
        customer: { email: 'test@example.com', name: 'Test Customer' },
        items: [{ sku: 'test-sku', name: 'Test Item', qty: 1, price: 10.0 }],
        total: 10.0
      },
      auth: { uid: 'test-user-123' } // Mock authenticated user
    };
    
    try {
      const orderResult = await createOrder.handler(orderRequestWithAuth);
      console.log('✅ Order result:', orderResult);
    } catch (error) {
      console.log('❌ Order error:', error.message);
    }

    console.log('\n🎉 Function tests completed!');

  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

// Run tests if called directly
if (require.main === module) {
  testFunctions();
}

module.exports = { testFunctions };
