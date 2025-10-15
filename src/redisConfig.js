const fs = require('fs');
const path = require('path');

/**
 * Redis Configuration for BullMQ
 * Supports both regular and TLS connections
 */
function createRedisConfig() {
  const config = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    db: parseInt(process.env.REDIS_DB) || 1,
    username: process.env.REDIS_USERNAME || 'default',
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  };

  // Add password if provided
  if (process.env.REDIS_PASSWORD) {
    config.password = process.env.REDIS_PASSWORD;
  }

  // Add TLS configuration if enabled
  if (process.env.REDIS_TLS_ENABLED === 'true') {
    try {
      const certPath = process.env.REDIS_TLS_CERT_PATH;
      if (!certPath) {
        throw new Error('REDIS_TLS_CERT_PATH is required when TLS is enabled');
      }

      const resolvedCertPath = path.resolve(certPath);
      if (!fs.existsSync(resolvedCertPath)) {
        throw new Error(`Redis TLS certificate file not found: ${resolvedCertPath}`);
      }

      config.tls = {
        cert: fs.readFileSync(resolvedCertPath),
        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false'
      };

      console.log(`✅ Redis TLS enabled with certificate: ${resolvedCertPath}`);
    } catch (error) {
      console.error('❌ Redis TLS configuration error:', error.message);
      throw error;
    }
  }

  return config;
}

/**
 * Get BullMQ connection configuration
 */
function getBullMQConnection() {
  return {
    connection: createRedisConfig()
  };
}

/**
 * Test Redis connection
 */
async function testRedisConnection() {
  const Redis = require('ioredis');
  const redis = new Redis(createRedisConfig());

  try {
    await redis.ping();
    console.log('✅ Redis connection successful');
    await redis.quit();
    return true;
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message);
    await redis.quit();
    return false;
  }
}

module.exports = {
  createRedisConfig,
  getBullMQConnection,
  testRedisConnection
};
