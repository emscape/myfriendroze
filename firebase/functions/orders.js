const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Create order endpoint
 * Callable function with authentication
 * Creates a new order with customer information and items
 */
exports.createOrder = onCall({
  region: "us-west1"
}, async (request) => {
  logger.info("Create order endpoint called");

  // Check authentication - require authenticated user
  if (!request.auth) {
    logger.warn("Unauthenticated order creation attempt");
    throw new HttpsError('unauthenticated', 'Authentication required to create orders');
  }

  logger.info(`Order creation by user: ${request.auth.uid}`);

  const { customer, items, total, currency = "USD", notes } = request.data;

  try {
    // Validate required fields
    if (!customer || !items || total === undefined) {
      throw new HttpsError('invalid-argument', 'customer, items, and total are required');
    }

    // Validate customer
    if (!customer.email || !customer.name) {
      throw new HttpsError('invalid-argument', 'Customer email and name are required');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customer.email)) {
      throw new HttpsError('invalid-argument', 'Please provide a valid email address');
    }

    // Validate items
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      throw new HttpsError('invalid-argument', 'Items must be an array with 1-50 items');
    }

    // Validate each item
    for (const item of items) {
      if (!item.sku || !item.name || !item.qty || item.price === undefined) {
        throw new HttpsError('invalid-argument', 'Each item must have sku, name, qty, and price');
      }

      if (item.qty < 1 || item.qty > 999) {
        throw new HttpsError('invalid-argument', 'Item quantity must be between 1 and 999');
      }

      if (item.price < 0) {
        throw new HttpsError('invalid-argument', 'Item price must be non-negative');
      }
    }

    // Validate total
    if (total < 0) {
      throw new HttpsError('invalid-argument', 'Total must be non-negative');
    }

    // Validate currency
    const validCurrencies = ["USD", "EUR", "GBP", "CAD"];
    if (!validCurrencies.includes(currency)) {
      throw new HttpsError('invalid-argument', 'Currency must be one of: USD, EUR, GBP, CAD');
    }

    // Create order document
    const orderData = {
      customer: {
        email: customer.email.toLowerCase().trim(),
        name: customer.name.trim(),
        ...(customer.phone && { phone: customer.phone })
      },
      items: items.map(item => ({
        sku: item.sku.trim(),
        name: item.name.trim(),
        qty: item.qty,
        price: Math.round(item.price * 100) / 100, // Round to 2 decimal places
        ...(item.description && { description: item.description.trim() })
      })),
      total: Math.round(total * 100) / 100,
      currency,
      ...(notes && { notes: notes.trim() }),
      status: "pending",
      createdBy: request.auth.uid, // Track who created the order
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save to Firestore
    const orderRef = await admin.firestore().collection("orders").add(orderData);

    logger.info(`Order created successfully: ${orderRef.id} by user ${request.auth.uid}`);

    // Return response matching OpenAPI schema
    const response = {
      id: orderRef.id,
      status: "pending",
      createdAt: new Date().toISOString(),
      total: orderData.total
    };

    return response;

  } catch (error) {
    logger.error("Error creating order:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to create order');
  }
});
