import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';

// Initialize Redis connection using Upstash REST API
// Initialize Redis connection using Upstash REST API
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
  console.warn('⚠️ Redis credentials not found. Caching and queue disabled.');
}

// Fix invalid URL protocol from Upstash (https -> rediss)
const fixUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('https://')) {
    return url.replace('https://', 'rediss://');
  }
  if (!url.startsWith('rediss://') && !url.startsWith('redis://')) {
    return `rediss://${url}`;
  }
  return url;
};

const connectionUrl = fixUrl(redisUrl);

// Create Redis client for Upstash
const redisClient = connectionUrl && redisToken
  ? new Redis(connectionUrl, {
      tls: {
        rejectUnauthorized: false
      },
      password: redisToken,
      maxRetriesPerRequest: null, // Required for BullMQ
      family: 4, // Force IPv4
      retryStrategy: (times) => {
        // Stop retrying after 3 attempts if it's a limit error or similar
        // or just delay retries (linear backoff)
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError: (err) => {
        const targetError = "READONLY";
        if (err.message.includes("limit exceeded") || err.message.includes(targetError)) {
          // Only reconnect when the error starts with "READONLY" or is a limit error
          return false; // Do not reconnect automatically for limit errors, let it fail gracefully
        }
        return true;
      }
    })
  : null;

// Test connection
if (redisClient) {
  redisClient.on('connect', () => {
    console.log('✅ Redis connected successfully');
  });

  redisClient.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message);
  });
}

// Create BullMQ Queue for order processing
const orderQueue = redisClient
  ? new Queue('orders', {
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
   * Delete all keys matching pattern
   */
  async delPattern(pattern) {
    if (!redisClient) return false;
    try {
      const keys = await redisClient.keys(pattern);
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

export { redisClient, orderQueue };
