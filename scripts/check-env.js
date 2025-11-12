#!/usr/bin/env node
/**
 * Environment Validation Script
 * 
 * Run: node scripts/check-env.js
 * Or: npm run check-env
 * 
 * This script validates all required environment variables before startup.
 */

import { validateEnv, isProductionMode } from "../src/config/env.js";

try {
  validateEnv();
  console.log("\n✅ Environment validation passed! Server can start safely.\n");
  process.exit(0);
} catch (error) {
  console.error("\n❌ Environment validation failed!\n");
  console.error(error.message);
  console.error(
    "\n📖 Fix guide:\n",
    "1. Check your .env file for missing or invalid values\n",
    "2. Review .env.example for required variables\n",
    "3. Ensure all sensitive values are set correctly\n",
    "4. In production, set variables via platform environment\n"
  );
  process.exit(1);
}
