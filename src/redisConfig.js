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
      config.tls = {
        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false'
      };

      // Add client certificate if path is provided (optional for valkey)
      const certPath = process.env.REDIS_TLS_CERT_PATH;
      if (certPath) {
        const resolvedCertPath = path.resolve(certPath);
        if (fs.existsSync(resolvedCertPath)) {
          config.tls.cert = fs.readFileSync(resolvedCertPath);
          console.log(`✅ Redis TLS enabled with client certificate: ${resolvedCertPath}`);
        } else {
          console.warn(`⚠️ TLS cert path provided but file not found: ${resolvedCertPath}`);
        }
      } else {
        console.log(`✅ Redis TLS enabled without client certificate (server auth only)`);
      }
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
