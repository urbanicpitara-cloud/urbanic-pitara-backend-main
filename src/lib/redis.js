import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';

// Check if Redis should be enabled (defaults to false for safety)
const REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';

if (!REDIS_ENABLED) {
  console.warn('⚠️  Redis is DISABLED (set REDIS_ENABLED=true to enable)');
}

// Support both Upstash REST API and standard Redis (Render, etc.)
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_PASSWORD;

if (REDIS_ENABLED && !redisUrl) {
  console.warn('⚠️  Redis URL not found. Set UPSTASH_REDIS_REST_URL or REDIS_URL');
}

// Detect if using Upstash (HTTPS-based) vs standard Redis
const isUpstash = redisUrl?.startsWith('https://') || process.env.UPSTASH_REDIS_REST_URL;

// Fix invalid URL protocol from Upstash (https -> rediss)
const fixUpstashUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('https://')) {
    return url.replace('https://', 'rediss://');
  }
  return url;
};

const connectionUrl = isUpstash ? fixUpstashUrl(redisUrl) : redisUrl;

// Create Redis client
let redisClient = null;

const retryStrategy = (times) => {
  // Exponential backoff: 200ms, 400ms, 800ms... capped at 30s
  const delay = Math.min(times * 200, 30000);
  console.log(`🔄 Redis reconnect attempt #${times} in ${delay}ms`);
  return delay;
};

const reconnectOnError = (err) => {
  // Reconnect on READONLY errors (failover)
  return err.message.includes('READONLY');
};

if (REDIS_ENABLED && connectionUrl) {
  if (isUpstash) {
    // Upstash: uses REST API with token auth
    redisClient = new Redis(connectionUrl, {
      tls: { rejectUnauthorized: false },
      password: redisToken,
      maxRetriesPerRequest: null, // Required for BullMQ
      family: 4, // Force IPv4
      retryStrategy,
      reconnectOnError,
    });
  } else {
    // Standard Redis (Render, self-hosted, etc.)
    redisClient = new Redis(connectionUrl, {
      maxRetriesPerRequest: null,
      family: 4,
      retryStrategy,
      reconnectOnError,
    });
  }
}

// Throttled error logging to prevent log spam
let lastRedisErrorLog = 0;
const REDIS_ERROR_LOG_INTERVAL = 30000; // Log at most once per 30s

if (redisClient) {
  redisClient.on('connect', () => {
    console.log('✅ Redis connected successfully');
  });

  redisClient.on('error', (err) => {
    const now = Date.now();
    if (now - lastRedisErrorLog > REDIS_ERROR_LOG_INTERVAL) {
      console.error('❌ Redis connection error:', err.message);
      lastRedisErrorLog = now;
    }
  });
}

// Create BullMQ Queues
const orderQueue = redisClient
  ? new Queue('orders', {
      connection: redisClient,
    })
  : null;

const emailQueue = redisClient
  ? new Queue('emails', {
      connection: redisClient,
    })
  : null;

/**
 * Cache Helper Functions
 */
export const cache = {
  /**
   * Get cached value
   */
  async get(key) {
    if (!redisClient) return null;
    try {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  },

  /**
   * Set cached value with TTL (in seconds)
   */
  async set(key, value, ttl = 300) {
    if (!redisClient) return false;
    try {
      await redisClient.setex(key, ttl, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  },

  /**
   * Delete cached value(s)
   */
  async del(...keys) {
    if (!redisClient) return false;
    try {
      await redisClient.del(...keys);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  },

  /**
   * Delete all keys matching pattern (uses SCAN for production safety)
   */
  async delPattern(pattern) {
    if (!redisClient) return false;
    try {
      // Use SCAN instead of KEYS (O(N) -> O(1) per iteration)
      const scan = redisClient.scanStream({ match: pattern, count: 100 });
      const keys = await new Promise((resolve, reject) => {
        const found = [];
        scan.on('data', (k) => found.push(...k));
        scan.on('end', () => resolve(found));
        scan.on('error', reject);
      });
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
      return true;
    } catch (error) {
      console.error('Cache delete pattern error:', error);
      return false;
    }
  },
};

/**
 * Health check for Redis connection
 */
export async function checkRedisHealth() {
  if (!redisClient) return { healthy: false, reason: 'Redis not enabled' };
  try {
    await redisClient.ping();
    return { healthy: true };
  } catch (error) {
    return { healthy: false, reason: error.message };
  }
}

/**
 * Check if queue is ready (non-null)
 */
export function isQueueReady() {
  return orderQueue !== null;
}

export { redisClient, orderQueue, emailQueue, cache as default };
