/**
 * Error Logging Integration with Sentry
 * 
 * Provides centralized error tracking, performance monitoring, and alerting.
 * Works seamlessly in both dev and production environments.
 * 
 * In Production: Captures real errors and performance issues
 * In Development: Disabled by default (can be enabled with SENTRY_DSN)
 */

import * as Sentry from "@sentry/node";
import * as SentryTracing from "@sentry/tracing";
import { getEnv, isProductionMode } from "./env.js";

const SENTRY_DSN = getEnv("SENTRY_DSN");

/**
 * Initialize Sentry for error tracking
 * Only initializes if SENTRY_DSN is configured
 */
export function initSentry(app) {
  if (!SENTRY_DSN) {
    console.log("ℹ️  Sentry error logging not configured (SENTRY_DSN not set)");
    return;
  }

  console.log("🔍 Initializing Sentry for error tracking...");

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: isProductionMode() ? 0.1 : 1.0, // 10% in prod, 100% in dev
    integrations: [
      // Enable HTTP client tracing
      new Sentry.Integrations.Http({ tracing: true }),
      // Enable Express middleware tracing
      new SentryTracing.Integrations.Express({
        app: true,
        request: true,
        transaction: true,
      }),
    ],

    // Ignore certain errors (development noise)
    denyUrls: [
      // Browser extensions
      /extensions\//i,
      /^chrome:\/\//i,
      // Skip CORS errors from browser
      /cross-origin/i,
    ],

    beforeSend(event, hint) {
      // Don't send 404 errors
      if (event.exception) {
        const error = hint.originalException;
        if (error?.message?.includes("404") || error?.status === 404) {
          return null;
        }
      }
      return event;
    },
  });

  // Attach request handler to extract useful context
  app.use(
    Sentry.Handlers.requestHandler({
      serverName: true,
      user: ["id", "email", "isAdmin"],
      request: ["url", "method", "headers", "query", "cookies"],
    })
  );

  // Attach tracing middleware
  app.use(Sentry.Handlers.tracingHandler());

  console.log("✅ Sentry initialized successfully");
}

/**
 * Attach Sentry error handler to Express
 * Must be called AFTER all other middleware and routes
 */
export function attachSentryErrorHandler(app) {
  if (!SENTRY_DSN) return;

  // Sentry error handler - MUST be last
  app.use(Sentry.Handlers.errorHandler());
}

/**
 * Capture a manual error event
 */
export function captureError(error, context = {}) {
  if (!SENTRY_DSN) {
    console.error("Error occurred:", error);
    return;
  }

  Sentry.withScope((scope) => {
    // Add custom context
    Object.entries(context).forEach(([key, value]) => {
      scope.setContext(key, value);
    });

    Sentry.captureException(error);
  });
}

/**
 * Capture a message (info, warning, error level)
 */
export function captureMessage(message, level = "info", context = {}) {
  if (!SENTRY_DSN) {
    console.log(`[${level.toUpperCase()}] ${message}`);
    return;
  }

  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setContext(key, value);
    });

    Sentry.captureMessage(message, level);
  });
}

/**
 * Set user context for error tracking
 */
export function setUserContext(userId, email, isAdmin = false) {
  if (!SENTRY_DSN) return;

  Sentry.setUser({
    id: userId,
    email,
    isAdmin,
  });
}

/**
 * Clear user context (on logout)
 */
export function clearUserContext() {
  if (!SENTRY_DSN) return;
  Sentry.setUser(null);
}

/**
 * Track a transaction/operation
 */
export function startTransaction(name, op = "http.request") {
  if (!SENTRY_DSN) return null;

  return Sentry.startTransaction({
    name,
    op,
  });
}

export default {
  initSentry,
  attachSentryErrorHandler,
  captureError,
  captureMessage,
  setUserContext,
  clearUserContext,
  startTransaction,
};
