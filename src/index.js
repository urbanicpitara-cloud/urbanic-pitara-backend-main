import express from "express";
import compression from "compression";
import morgan from "morgan";
import cookieParser from "cookie-parser";

// ✅ Environment Configuration
import { validateEnv, isProductionMode, printSensitiveVars } from "./config/env.js";

// ✅ Security
import {
  configureSecurityHeaders,
  configureCors,
  configureHttpsRedirect,
  createGlobalRateLimiter,
  createStrictRateLimiter,
  createPaymentRateLimiter,
} from "./config/security.js";

// ✅ Routes
import collectionsRouter from "./routes/collections.js";
import productsRouter from "./routes/products.js";
import searchRouter from "./routes/search.js";

import authRouter from "./routes/auth.js";
import cartRouter from "./routes/cart.js";
import addressesRouter from "./routes/addresses.js";
import ordersRouter from "./routes/orders.js";
import discountRouter from "./routes/discount.js";
import tagsRouter from "./routes/tags.js";
import userRouter from "./routes/users.js";
import subscriptionsRouter from "./routes/subscriptions.js";
import paymentRouter from "./routes/payment.js";
import customizerRouter from "./routes/customizer.js";
import adminCustomizerRouter from "./routes/admin-customizer.js";
import downloadAssetsRouter from "./routes/download-assets.js";
import variantGroupsRouter from "./routes/variantGroups.js";
import catalogRouter from "./routes/catalog.js"; // 🆕 Variant Groups
import orderWorker from "./workers/order-processor.js"; // 🆕 Order Worker
import emailWorker from "./workers/email-processor.js"; // 🆕 Email Worker
import { isQueueReady } from "./lib/redis.js";

// Order worker auto-starts when imported (BullMQ worker)
if (orderWorker) {
  console.log("✅ Order worker loaded and ready");
} else {
  console.log("⚠️  Order worker disabled (Redis not available)");
}


console.log("\n🔍 Validating environment configuration...\n");
validateEnv();

// If not production, print sensitive vars (masked)
if (!isProductionMode()) {
  printSensitiveVars();
}

const app = express();

// ✅ Trust proxy settings
app.set("trust proxy", 1);

// ✅ Security Headers (Helmet)
configureSecurityHeaders(app);

// ✅ HTTPS Redirect (Production)
configureHttpsRedirect(app);

// ✅ CORS Configuration (Strict in Production)
configureCors(app);

// ✅ Logging Middleware (includes response time in production)
app.use(
  morgan(
    isProductionMode()
      ? ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" - :response-time ms'
      : "dev"
  )
);

// ✅ Compression
app.use(compression());

// ✅ Cookie Parser
app.use(cookieParser());

// ✅ JSON Parser with size limit
app.use(express.json({ limit: "1mb" }));

// ✅ Root health check for Render probes (must return 200)
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "urbanic-pitara-api" });
});

// ✅ Detailed health check endpoint (no rate limit)
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    environment: process.env.NODE_ENV || "development",
    queueReady: isQueueReady(),
    timestamp: new Date().toISOString()
  });
});

// ✅ Global Rate Limiting (lenient)
app.use(createGlobalRateLimiter());

// ✅ Auth Routes (with strict rate limiting)
const strictLimiter = createStrictRateLimiter();
app.use("/auth", strictLimiter, authRouter);

// ✅ Payment Routes (with payment-specific rate limiting)
const paymentLimiter = createPaymentRateLimiter();
app.use("/payment", paymentLimiter, paymentRouter);

// ✅ Admin Payment Routes (explicit mount so frontend can call /admin/payment/:id)
// Uses the strict limiter to protect admin operations
app.use("/admin/payment", strictLimiter, paymentRouter);

// ✅ Public Routes
app.use("/collections", collectionsRouter);
app.use("/products", productsRouter);
app.use("/catalog", catalogRouter);
app.use("/search", searchRouter);

app.use("/cart", cartRouter);
app.use("/customizer", customizerRouter);
app.use("/admin/customizer", adminCustomizerRouter);
app.use("/download-assets", downloadAssetsRouter);
app.use("/variant-groups", variantGroupsRouter); // 🆕 Variant Groups


// ✅ Protected Routes (require authentication)
app.use("/addresses", addressesRouter);
app.use("/orders", ordersRouter);
app.use("/discounts", discountRouter);
app.use("/tags", tagsRouter);
app.use("/users", userRouter);
app.use("/subscriptions", subscriptionsRouter);

// ✅ 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

// ✅ Centralized Error Handler (MUST BE LAST)
// ✅ Centralized Error Handler (MUST BE LAST)
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";

  // 📝 Standardized Response Structure
  const response = {
    error: message,
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
  };

  // Include stack trace in development
  if (!isProductionMode()) {
    response.stack = err.stack;
  }

  // 🔍 Enhanced Server Logging
  console.error("❌ [API Error]", {
    timestamp: new Date().toISOString(),
    status,
    message,
    path: req.path,
    method: req.method,
    // Safely log body (mask sensitive fields if needed later)
    body: Object.keys(req.body || {}).length ? req.body : undefined,
    query: Object.keys(req.query || {}).length ? req.query : undefined,
    stack: isProductionMode() ? undefined : err.stack?.split('\n')[1]?.trim(), // First line of stack
  });

  res.status(status).json(response);
});

// ✅ Server Startup
const port = process.env.PORT || 4000;
const server = app.listen(port, () => {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                 🚀 SERVER STARTED SUCCESSFULLY             ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  console.log(`✅ API running on http://localhost:${port}`);
  console.log(`📝 Environment: ${isProductionMode() ? "PRODUCTION" : "DEVELOPMENT"}`);
  console.log(`🔐 PHONEPE_MOCK: ${process.env.PHONEPE_MOCK === "true" ? "ENABLED (Mock Mode)" : "DISABLED (Real Mode)"}`);
  console.log("\n");
});

// ✅ Graceful Shutdown
process.on("SIGTERM", async () => {
  console.log("\n⚠️  SIGTERM received. Shutting down gracefully...");
  if (orderWorker) {
    await orderWorker.close();
    console.log("✅ Order worker closed");
  }
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  console.log("\n⚠️  SIGINT received. Shutting down gracefully...");
  if (orderWorker) {
    await orderWorker.close();
    console.log("✅ Order worker closed");
  }
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

export default app;
