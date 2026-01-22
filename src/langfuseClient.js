const { Langfuse } = require('langfuse');

// Shared Langfuse client used across routes and workers.
const langfuseClient = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASEURL,
  environment: process.env.LANGFUSE_ENVIRONMENT || 'development',
});

/**
 * Safely create a Langfuse trace without breaking the request when Langfuse is misconfigured.
 */
function createTrace(config) {
  try {
    return langfuseClient.trace(config);
  } catch (error) {
    console.warn('⚠️ Langfuse tracing disabled or misconfigured:', error.message);
    return null;
  }
}

/**
 * Flush Langfuse events. We intentionally avoid shutting down the client so the long-lived
 * worker/server can continue emitting traces.
 */
async function flushLangfuse() {
  try {
    if (typeof langfuseClient.flushAsync === 'function') {
      await langfuseClient.flushAsync();
    }
  } catch (error) {
    console.warn('⚠️ Failed to flush Langfuse events:', error.message);
  }
}

module.exports = {
  langfuseClient,
  createTrace,
  flushLangfuse,
};
