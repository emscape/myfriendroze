// Product deletion API endpoint for Flutter-Astro integration
// Handles individual product deletion from Flutter admin app

import { deleteProduct, getProduct } from '../../../data/syncedProducts.js';

// Enable server-side rendering for API endpoints
export const prerender = false;

export async function DELETE({ params }) {
  try {
    const productId = params.id;

    if (!productId) {
      return new Response(
        JSON.stringify({ 
          error: 'Product ID is required',
          success: false 
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Find and delete the product
    const deletedProduct = deleteProduct(productId);

    if (!deletedProduct) {
      return new Response(
        JSON.stringify({
          error: 'Product not found',
          success: false
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Product deleted:', {
      id: deletedProduct.id,
      title: deletedProduct.title,
      deletedAt: new Date().toISOString()
    });

    return new Response(
      JSON.stringify({
        success: true,
        id: deletedProduct.id,
        message: 'Product deleted successfully',
        data: {
          id: deletedProduct.id,
          title: deletedProduct.title,
          status: 'deleted',
          deletedAt: new Date().toISOString()
        }
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Product deletion error:', error);

    return new Response(
      JSON.stringify({ 
        error: 'Failed to delete product. Please try again.',
        success: false 
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// GET endpoint to retrieve a specific product
export async function GET({ params }) {
  try {
    const productId = params.id;

    if (!productId) {
      return new Response(
        JSON.stringify({ 
          error: 'Product ID is required',
          success: false 
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Find the product
    const product = getProduct(productId);
    
    if (!product) {
      return new Response(
        JSON.stringify({ 
          error: 'Product not found',
          success: false 
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: product
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Product retrieval error:', error);

    return new Response(
      JSON.stringify({ 
        error: 'Failed to retrieve product. Please try again.',
        success: false 
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Handle non-supported methods
export async function POST() {
  return new Response(
    JSON.stringify({ error: 'Method not allowed. Use DELETE to remove products or GET to retrieve them.' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export async function PUT() {
  return new Response(
    JSON.stringify({ error: 'Method not allowed. Use DELETE to remove products or GET to retrieve them.' }),
    { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
