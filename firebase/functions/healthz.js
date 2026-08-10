const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

/**
 * Health check endpoint
 * Callable function - no authentication required for health checks
 * Returns the health status of the API
 */
exports.healthz = onCall({
  region: "us-west1"
}, async (request) => {
  logger.info("Health check endpoint called");

  try {
    // Basic health checks could be added here
    // For now, just return healthy status
    const response = {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "1.0.0"
    };

    logger.info("Health check successful");
    return response;

  } catch (error) {
    logger.error("Health check failed:", error);
    throw new HttpsError('internal', 'Service unavailable');
  }
});
