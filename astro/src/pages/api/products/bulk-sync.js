// Bulk product sync API endpoint for Flutter-Astro integration
// Handles multiple product sync from Flutter admin app

import { syncedProducts, addProduct, updateProduct } from '../../../data/syncedProducts.js';

// Enable server-side rendering for API endpoints
export const prerender = false;

export async function POST({ request }) {
  try {
    // Check if request has body
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return new Response(
        JSON.stringify({
          error: 'Content-Type must be application/json',
          success: false
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const requestData = await request.json();
    
    // Validate that products array is provided
    if (!requestData.products || !Array.isArray(requestData.products)) {
      return new Response(
        JSON.stringify({ 
          error: 'Products array is required',
          success: false 
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (requestData.products.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Products array cannot be empty',
          success: false 
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Limit bulk operations to prevent overload
    if (requestData.products.length > 100) {
      return new Response(
        JSON.stringify({ 
          error: 'Bulk sync limited to 100 products per request',
          success: false 
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const results = {
      success: true,
      message: 'Bulk sync completed',
      summary: {
        total: requestData.products.length,
        created: 0,
        updated: 0,
        failed: 0
      },
      details: [],
      errors: []
    };

    // Process each product
    for (let i = 0; i < requestData.products.length; i++) {
      const productData = requestData.products[i];
      
      try {
        // Validate required fields for each product
        const requiredFields = ['id', 'title', 'description', 'price', 'weight', 'imageUrls', 'isActive'];
        const missingFields = requiredFields.filter(field => productData[field] === undefined || productData[field] === null);
        
        if (missingFields.length > 0) {
          results.summary.failed++;
          results.errors.push({
            productId: productData.id || `index-${i}`,
            error: `Missing required fields: ${missingFields.join(', ')}`
          });
          continue;
        }

        // Validate data types
        if (typeof productData.price !== 'number' || productData.price < 0) {
          results.summary.failed++;
          results.errors.push({
            productId: productData.id,
            error: 'Price must be a positive number'
          });
          continue;
        }

        if (typeof productData.weight !== 'number' || productData.weight < 0) {
          results.summary.failed++;
          results.errors.push({
            productId: productData.id,
            error: 'Weight must be a positive number'
          });
          continue;
        }

        if (!Array.isArray(productData.imageUrls)) {
          results.summary.failed++;
          results.errors.push({
            productId: productData.id,
            error: 'imageUrls must be an array'
          });
          continue;
        }

        // Transform Flutter product data to Astro product format
        const astroProduct = {
          id: productData.id,
          handle: productData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          title: productData.title,
          description: productData.description,
          price: productData.price,
          compareAtPrice: null,
          images: productData.imageUrls,
          tags: [],
          inStock: productData.isActive,
          category: 'Planters', // Default category
          dimensions: '', // Could be extracted from description or added to schema
          features: ['Handcrafted ceramic', 'Drainage holes'],
          weight: productData.weight,
          seoTitle: `${productData.title} | myfriendroze`,
          seoDescription: productData.description.substring(0, 160) + (productData.description.length > 160 ? '...' : ''),
          syncedAt: new Date().toISOString(),
          createdAt: productData.createdAt || new Date().toISOString(),
          updatedAt: productData.updatedAt || new Date().toISOString()
        };

        // Check if product exists and update or create
        const existingProduct = syncedProducts.find(p => p.id === productData.id);

        if (existingProduct) {
          // Update existing product
          updateProduct(productData.id, astroProduct);
          results.summary.updated++;
          results.details.push({
            id: productData.id,
            title: productData.title,
            status: 'updated'
          });
        } else {
          // Create new product
          addProduct(astroProduct);
          results.summary.created++;
          results.details.push({
            id: productData.id,
            title: productData.title,
            status: 'created'
          });
        }

      } catch (error) {
        results.summary.failed++;
        results.errors.push({
          productId: productData.id || `index-${i}`,
          error: error.message || 'Unknown error occurred'
        });
      }
    }

    // Log bulk sync results
    console.log('Bulk sync completed:', {
      total: results.summary.total,
      created: results.summary.created,
      updated: results.summary.updated,
      failed: results.summary.failed
    });

    // Return appropriate status code based on results
    const statusCode = results.summary.failed === 0 ? 200 : 
                      (results.summary.created > 0 || results.summary.updated > 0) ? 207 : // Partial success
                      400; // All failed

    return new Response(
      JSON.stringify(results),
      {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Bulk sync error:', error);

    return new Response(
      JSON.stringify({ 
        error: 'Failed to process bulk sync. Please try again.',
        success: false 
      }),
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
    JSON.stringify({ error: 'Method not allowed. Use POST for bulk sync.' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export async function PUT() {
  return new Response(
    JSON.stringify({ error: 'Method not allowed. Use POST for bulk sync.' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export async function DELETE() {
  return new Response(
    JSON.stringify({ error: 'Method not allowed. Use POST for bulk sync.' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
