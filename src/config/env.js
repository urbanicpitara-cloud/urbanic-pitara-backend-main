/**
 * Environment Configuration System
 * 
 * This module validates and manages all environment variables for development and production.
 * Works the same way in dev with dev keys and in production with prod keys.
 * 
 * Usage:
 *   - Dev: Set dev keys in .env and run normally
 *   - Prod: Set prod keys in platform (Render/Vercel secrets) and deploy
 */

import dotenv from "dotenv";

// Load .env file if in development
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const ENV = process.env.NODE_ENV || "development";
const isDev = ENV === "development";
const isProd = ENV === "production";

/**
 * Required environment variables
 * 
 * Format: { key: 'VAR_NAME', required: true/false, default: 'value' }
 */
const REQUIRED_ENV_VARS = [
  // Core
  { key: "NODE_ENV", required: false, default: "development" },
  { key: "PORT", required: false, default: "4000" },
  
  // Database
  { key: "DATABASE_URL", required: true },
  
  // JWT & Security
  { key: "JWT_SECRET", required: true },
  { key: "JWT_EXPIRY", required: false, default: "7d" },
  
  // CORS & Frontend
  { key: "CORS_ORIGIN", required: true },
  { key: "FRONTEND_URL", required: true },
  { key: "BACKEND_URL", required: true },
  
  // SMTP (Email)
  { key: "SMTP_HOST", required: false },
  { key: "SMTP_PORT", required: false },
  { key: "SMTP_USER", required: false },
  { key: "SMTP_PASS", required: false },
  { key: "FROM_EMAIL", required: false },
  
  // PhonePe Payment Gateway
  { key: "PHONEPE_MERCHANT_ID", required: true },
  { key: "PHONEPE_SALT_KEY", required: true },
  { key: "PHONEPE_SALT_INDEX", required: false, default: "1" },
  { key: "PHONEPE_ENV", required: false, default: "UAT" },
  { key: "PHONEPE_API_URL", required: false, default: "https://api-preprod.phonepe.com/apis/pg-sandbox" },
  { key: "PHONEPE_TOKEN_URL", required: false, default: "https://api-preprod.phonepe.com/apis/pg-sandbox" },
  { key: "PHONEPE_CLIENT_ID", required: false },
  { key: "PHONEPE_CLIENT_SECRET", required: false },
  { key: "PHONEPE_CLIENT_VERSION", required: false, default: "v1" },
  { key: "PHONEPE_MOCK", required: false, default: "true" },
  
  // Error Logging (Optional - Sentry)
  { key: "SENTRY_DSN", required: false },
  
  // Optional Security
  { key: "TRUST_PROXY", required: false, default: "false" },
  { key: "COOKIE_DOMAIN", required: false },
];

/**
 * Validate all required environment variables
 * Throws error if any required variable is missing
 */
export function validateEnv() {
  const missing = [];
  const errors = [];

  for (const varConfig of REQUIRED_ENV_VARS) {
    const value = process.env[varConfig.key];

    if (!value && varConfig.required) {
      missing.push(varConfig.key);
    }

    // Validation rules for specific variables
    if (value) {
      // Validate JWT_SECRET length
      if (varConfig.key === "JWT_SECRET" && value.length < 32) {
        errors.push(
          `${varConfig.key} must be at least 32 characters long (currently ${value.length})`
        );
      }

      // Validate PORT is a number
      if (varConfig.key === "PORT" && isNaN(parseInt(value))) {
        errors.push(`${varConfig.key} must be a valid number`);
      }

      // Validate DATABASE_URL format
      if (
        varConfig.key === "DATABASE_URL" &&
        !value.startsWith("postgresql://") &&
        !value.startsWith("postgres://")
      ) {
        errors.push(
          `${varConfig.key} must be a PostgreSQL connection string starting with postgresql://`
        );
      }

      // Validate URLs
      if (
        (varConfig.key === "FRONTEND_URL" ||
          varConfig.key === "BACKEND_URL" ||
          varConfig.key === "CORS_ORIGIN") &&
        !isValidUrl(value)
      ) {
        errors.push(`${varConfig.key} must be a valid URL`);
      }
    }
  }

  // Print validation result
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║           🔐 ENVIRONMENT VALIDATION REPORT                 ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log(`Environment: ${ENV}`);
  console.log(
    `PHONEPE_MOCK: ${process.env.PHONEPE_MOCK === "true" ? "✅ MOCK MODE (Dev)" : "✅ REAL MODE (Production)"}\n`
  );

  if (missing.length === 0 && errors.length === 0) {
    console.log("✅ All environment variables validated successfully!\n");
    return true;
  }

  if (missing.length > 0) {
    console.error("❌ MISSING REQUIRED VARIABLES:");
    missing.forEach((v) => console.error(`   • ${v}`));
    console.error();
  }

  if (errors.length > 0) {
    console.error("❌ INVALID VARIABLE VALUES:");
    errors.forEach((e) => console.error(`   • ${e}`));
    console.error();
  }

  throw new Error(
    `Environment validation failed: ${missing.length} missing, ${errors.length} invalid`
  );
}

/**
 * Get environment variable with fallback to default
 */
export function getEnv(key, defaultValue = null) {
  return process.env[key] ?? defaultValue;
}

/**
 * Check if we're in development mode
 */
export function isDevMode() {
  return isDev;
}

/**
 * Check if we're in production mode
 */
export function isProductionMode() {
  return isProd;
}

/**
 * Helper: Validate URL format
 */
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Print sensitive env vars (masked for security)
 */
export function printSensitiveVars() {
  const sensitiveKeys = [
    "JWT_SECRET",
    "DATABASE_URL",
    "PHONEPE_SALT_KEY",
    "PHONEPE_CLIENT_SECRET",
    "SMTP_PASS",
    "SENTRY_DSN",
  ];

  console.log("\n📋 Active Configuration (Sensitive values masked):\n");

  for (const key of sensitiveKeys) {
    const value = process.env[key];
    if (value) {
      const masked = maskSensitive(value);
      console.log(`  ${key}: ${masked}`);
    }
  }

  console.log();
}

/**
 * Mask sensitive values for logging
 */
function maskSensitive(value) {
  if (!value) return "NOT SET";
  if (value.length <= 8) return "***";

  const visible = value.substring(0, 4);
  const hidden = "*".repeat(Math.min(value.length - 8, 10));
  const end = value.substring(value.length - 4);

  return `${visible}${hidden}${end}`;
}

export default {
  validateEnv,
  getEnv,
  isDevMode,
  isProductionMode,
  printSensitiveVars,
  ENV,
  isDev,
  isProd,
};
