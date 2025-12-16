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
import menuRouter from "./routes/menu.js";
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
import "./workers/order-processor.js"; // Start order processing worker
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

// ✅ Logging Middleware
app.use(morgan(isProductionMode() ? "combined" : "dev"));

// ✅ Compression
app.use(compression());

// ✅ Cookie Parser
app.use(cookieParser());

// ✅ JSON Parser with size limit
app.use(express.json({ limit: "1mb" }));

// ✅ Health check endpoint (no rate limit)
app.get("/health", (_req, res) => {
  res.json({ 
    ok: true, 
    environment: process.env.NODE_ENV || "development",
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
app.use("/search", searchRouter);
app.use("/menu", menuRouter);
app.use("/cart", cartRouter);
app.use("/customizer", customizerRouter);
app.use("/admin/customizer", adminCustomizerRouter);
app.use("/download-assets", downloadAssetsRouter);

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
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";
  const response = {
    error: message,
    timestamp: new Date().toISOString(),
  };

  // Include stack trace in development
  if (!isProductionMode()) {
    response.stack = err.stack;
  }

  console.error("❌ Error:", {
    status,
    message,
    path: _req.path,
    method: _req.method,
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
process.on("SIGTERM", () => {
  console.log("\n⚠️  SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\n⚠️  SIGINT received. Shutting down gracefully...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

export default app;
