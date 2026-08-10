// Product sync API endpoint for Flutter-Astro integration
// Handles single product sync from Flutter admin app

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

    const productData = await request.json();

    // Validate required fields according to A2's schema
    const requiredFields = ['id', 'title', 'description', 'price', 'weight', 'imageUrls', 'isActive'];
    const missingFields = requiredFields.filter(field => productData[field] === undefined || productData[field] === null);
    
    if (missingFields.length > 0) {
      return new Response(
        JSON.stringify({ 
          error: `Missing required fields: ${missingFields.join(', ')}`,
          success: false 
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate data types
    if (typeof productData.price !== 'number' || productData.price < 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Price must be a positive number',
          success: false 
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (typeof productData.weight !== 'number' || productData.weight < 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Weight must be a positive number',
          success: false 
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (!Array.isArray(productData.imageUrls)) {
      return new Response(
        JSON.stringify({ 
          error: 'imageUrls must be an array',
          success: false 
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
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
      const updatedProduct = updateProduct(productData.id, astroProduct);
      
      console.log('Product updated:', {
        id: productData.id,
        title: productData.title,
        price: productData.price,
        isActive: productData.isActive
      });

      return new Response(
        JSON.stringify({
          success: true,
          id: productData.id,
          message: 'Product updated successfully',
          data: {
            id: productData.id,
            title: productData.title,
            status: 'updated',
            syncedAt: astroProduct.syncedAt
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      // Create new product
      addProduct(astroProduct);
      
      console.log('Product created:', {
        id: productData.id,
        title: productData.title,
        price: productData.price,
        isActive: productData.isActive
      });

      return new Response(
        JSON.stringify({
          success: true,
          id: productData.id,
          message: 'Product created successfully',
          data: {
            id: productData.id,
            title: productData.title,
            status: 'created',
            syncedAt: astroProduct.syncedAt
          }
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

  } catch (error) {
    console.error('Product sync error:', error);

    return new Response(
      JSON.stringify({ 
        error: 'Failed to sync product. Please try again.',
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
    JSON.stringify({ error: 'Method not allowed. Use POST to sync products.' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export async function PUT() {
  return new Response(
    JSON.stringify({ error: 'Method not allowed. Use POST to sync products.' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export async function DELETE() {
  return new Response(
    JSON.stringify({ error: 'Method not allowed. Use POST to sync products.' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
