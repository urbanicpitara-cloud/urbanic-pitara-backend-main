/**
 * Security & CORS Configuration
 * 
 * Provides production-grade security headers, strict CORS,
 * and HTTPS enforcement for production deployments.
 */

import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { isProductionMode, getEnv } from "./env.js";

/**
 * Get CORS origins based on environment
 */
function getCorsOrigins() {
  const corsOrigin = getEnv("CORS_ORIGIN", "http://localhost:3000");
  
  if (isProductionMode()) {
    // Production: Only allow exact domains (no wildcards!)
    // Example: ["https://urbanic-pitara.com", "https://admin.urbanic-pitara.com"]
    const origins = [corsOrigin];
    
    // Also allow FRONTEND_URL if set and different from CORS_ORIGIN
    const frontendUrl = process.env.FRONTEND_URL;
    if (frontendUrl && frontendUrl !== corsOrigin) {
      origins.push(frontendUrl);
    }
    
    return origins;
  }

  // Development: Allow localhost and dev tunnels
  return [
    corsOrigin,
    "http://localhost:3000",
    "http://localhost:4000",
    /localhost/,
    /\.vercel\.app$/,
    /\.devtunnels\.ms$/,
  ];
}

/**
 * Configure enhanced CORS for production
 */
export function configureSecurityHeaders(app) {
  // Helmet middleware for security headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      // Enforce HTTPS in production
      hsts: isProductionMode()
        ? {
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true,
          }
        : undefined,
      // Content Security Policy
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", getEnv("FRONTEND_URL", "http://localhost:3000")],
        },
      },
      // Prevent X-Frame-Options clickjacking
      frameguard: { action: "deny" },
      // Prevent MIME sniffing
      noSniff: true,
      // Prevent XSS attacks
      xssFilter: true,
    })
  );

  console.log("✅ Security headers configured");
}

/**
 * Configure CORS with production-grade strict settings
 */
export function configureCors(app) {
  const origins = getCorsOrigins();

  app.use(
    cors({
      origin: function (origin, callback) {
        // Allow no-origin requests (mobile apps, curl, etc.)
        if (!origin) {
          return callback(null, true);
        }

        // Check if origin is allowed
        const isAllowed = origins.some((allowed) => {
          if (allowed instanceof RegExp) {
            return allowed.test(origin);
          }
          return allowed === origin;
        });

        if (isAllowed) {
          callback(null, true);
        } else {
          if (isProductionMode()) {
            console.warn(`🚫 CORS blocked origin: ${origin}`);
          }
          callback(new Error("CORS not allowed"));
        }
      },

      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400, // 24 hours cache
    })
  );

  console.log("✅ CORS configured", {
    production: isProductionMode(),
    origins: origins.map((o) => (o instanceof RegExp ? o.toString() : o)),
  });
}

/**
 * Configure HTTPS redirect in production
 */
export function configureHttpsRedirect(app) {
  if (!isProductionMode()) return;

  app.use((req, res, next) => {
    // Check if request is not HTTPS
    if (req.header("x-forwarded-proto") !== "https") {
      res.redirect(301, `https://${req.header("host")}${req.url}`);
    } else {
      next();
    }
  });

  console.log("✅ HTTPS redirect configured");
}

/**
 * Global rate limiting
 * More lenient than endpoint-specific limits
 */
export function createGlobalRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isProductionMode() ? 100 : 1000, // 100 req/15min in prod, 1000 in dev
    message: {
      error: "Too many requests from this IP, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Don't limit health checks
      if (req.path === "/health") return true;
      return false;
    },
  });
}

/**
 * Strict rate limiting for sensitive endpoints
 * (Auth, Password Reset, Payment)
 */
export function createStrictRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isProductionMode() ? 5 : 50, // 5 attempts/15min in prod, 50 in dev
    message: {
      error: "Too many attempts. Please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req, res) => {
      // Skip for admins
      if (req.user?.isAdmin) {
        return true;
      }
      return false;
    },
  });
}

/**
 * Rate limiting for payment endpoints
 */
export function createPaymentRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: isProductionMode() ? 3 : 20, // 3 attempts/min in prod, 20 in dev
    message: {
      error: "Too many payment attempts. Please wait before trying again.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Rate limit by user ID if authenticated, otherwise by IP
      return req.user?.id || req.ip;
    },
  });
}

export default {
  configureSecurityHeaders,
  configureCors,
  configureHttpsRedirect,
  createGlobalRateLimiter,
  createStrictRateLimiter,
  createPaymentRateLimiter,
};
