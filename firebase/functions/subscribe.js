const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Create subscription endpoint
 * Callable function - allows both authenticated and anonymous subscriptions
 * Creates a new email subscription
 */
exports.createSubscription = onCall({
  region: "us-west1"
}, async (request) => {
  logger.info("Create subscription endpoint called");

  // Log if user is authenticated (optional for subscriptions)
  if (request.auth) {
    logger.info(`Subscription by authenticated user: ${request.auth.uid}`);
  } else {
    logger.info("Anonymous subscription");
  }

  const {
    email,
    firstName,
    lastName,
    preferences = { newsletter: true, promotions: false, productUpdates: false },
    source = "website",
    tags = []
  } = request.data;

  try {
    // Validate required fields
    if (!email) {
      throw new HttpsError('invalid-argument', 'email is required');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new HttpsError('invalid-argument', 'Please provide a valid email address');
    }

    // Validate source
    const validSources = ["website", "mobile_app", "social_media", "referral", "other"];
    if (!validSources.includes(source)) {
      throw new HttpsError('invalid-argument', 'Source must be one of: website, mobile_app, social_media, referral, other');
    }

    // Validate tags
    if (!Array.isArray(tags) || tags.length > 10) {
      throw new HttpsError('invalid-argument', 'Tags must be an array with maximum 10 items');
    }

    // Validate tag content
    for (const tag of tags) {
      if (typeof tag !== "string" || tag.length === 0 || tag.length > 30) {
        throw new HttpsError('invalid-argument', 'Each tag must be a string between 1-30 characters');
      }
    }

    // Validate name lengths if provided
    if (firstName && (firstName.length === 0 || firstName.length > 50)) {
      throw new HttpsError('invalid-argument', 'First name must be between 1-50 characters');
    }

    if (lastName && (lastName.length === 0 || lastName.length > 50)) {
      throw new HttpsError('invalid-argument', 'Last name must be between 1-50 characters');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists
    const existingSubscription = await admin.firestore()
      .collection("subscriptions")
      .where("email", "==", normalizedEmail)
      .get();

    if (!existingSubscription.empty) {
      throw new HttpsError('already-exists', 'This email address is already subscribed');
    }

    // Create subscription document
    const subscriptionData = {
      email: normalizedEmail,
      ...(firstName && { firstName: firstName.trim() }),
      ...(lastName && { lastName: lastName.trim() }),
      preferences: {
        newsletter: preferences.newsletter === true,
        promotions: preferences.promotions === true,
        productUpdates: preferences.productUpdates === true
      },
      source,
      tags: tags.map(tag => tag.trim()),
      status: "active",
      ...(request.auth && { createdBy: request.auth.uid }), // Track user if authenticated
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save to Firestore
    const subscriptionRef = await admin.firestore()
      .collection("subscriptions")
      .add(subscriptionData);

    logger.info(`Subscription created successfully: ${subscriptionRef.id} for ${normalizedEmail}`);

    // Return response matching OpenAPI schema
    const response = {
      id: subscriptionRef.id,
      email: normalizedEmail,
      status: "active",
      createdAt: new Date().toISOString()
    };

    return response;

  } catch (error) {
    logger.error("Error creating subscription:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to create subscription');
  }
});
