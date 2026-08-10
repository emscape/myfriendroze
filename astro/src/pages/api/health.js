// Health check API endpoint for Flutter-Astro integration
// Provides system status and connectivity information

import { products } from '../../data/products.js';

// Enable server-side rendering for API endpoints
export const prerender = false;

export async function GET({ request }) {
  try {
    const startTime = Date.now();
    
    // Basic system checks
    const checks = {
      api: true,
      database: true, // In production, this would check actual database connectivity
      products: true,
      timestamp: new Date().toISOString()
    };

    // Check if products data is accessible
    try {
      const productCount = products.length;
      checks.products = productCount >= 0;
      checks.productCount = productCount;
    } catch (error) {
      checks.products = false;
      checks.productError = error.message;
    }

    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Determine overall health status
    const isHealthy = Object.values(checks).every(check => 
      typeof check === 'boolean' ? check : true
    );

    const healthData = {
      status: isHealthy ? 'ok' : 'error',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime ? Math.floor(process.uptime()) : null,
      responseTime: `${responseTime}ms`,
      timestamp: checks.timestamp,
      checks: checks,
      endpoints: {
        'POST /api/products/sync': 'Single product sync',
        'POST /api/products/bulk-sync': 'Bulk product sync',
        'DELETE /api/products/{id}': 'Product deletion',
        'GET /api/health': 'Health check'
      }
    };

    // Add request information for debugging
    const url = new URL(request.url);
    healthData.request = {
      method: request.method,
      url: url.pathname,
      userAgent: request.headers.get('user-agent'),
      host: request.headers.get('host')
    };

    console.log('Health check requested:', {
      status: healthData.status,
      responseTime: healthData.responseTime,
      userAgent: healthData.request.userAgent
    });

    return new Response(
      JSON.stringify(healthData, null, 2),
      {
        status: isHealthy ? 200 : 503,
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    );

  } catch (error) {
    console.error('Health check error:', error);

    const errorResponse = {
      status: 'error',
      message: 'Health check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    };

    return new Response(
      JSON.stringify(errorResponse, null, 2),
      {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      }
    );
  }
}

// Handle non-GET requests
export async function POST() {
  return new Response(
    JSON.stringify({ 
      error: 'Method not allowed. Use GET for health checks.',
      allowedMethods: ['GET']
    }),
    { 
      status: 405,
      headers: { 
        'Content-Type': 'application/json',
        'Allow': 'GET'
      }
    }
  );
}

export async function PUT() {
  return new Response(
    JSON.stringify({ 
      error: 'Method not allowed. Use GET for health checks.',
      allowedMethods: ['GET']
    }),
    { 
      status: 405,
      headers: { 
        'Content-Type': 'application/json',
        'Allow': 'GET'
      }
    }
  );
}

export async function DELETE() {
  return new Response(
    JSON.stringify({ 
      error: 'Method not allowed. Use GET for health checks.',
      allowedMethods: ['GET']
    }),
    { 
      status: 405,
      headers: { 
        'Content-Type': 'application/json',
        'Allow': 'GET'
      }
    }
  );
}
