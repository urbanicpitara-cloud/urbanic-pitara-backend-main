import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";

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

dotenv.config();

const app = express();

/* ✅ Always trust proxy in dev/tunnel environments */
if (process.env.NODE_ENV !== "production" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

/* ✅ Security, logging & performance middleware */
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(compression());

/* ✅ CORS configuration */
const allowedOrigins = [
  process.env.CORS_ORIGIN || "http://localhost:3000",
  "http://localhost:3000",
  /\.devtunnels\.ms$/, // ✅ allow any VS Code Dev Tunnel domain
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

/* ✅ Health check endpoint */
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ✅ Rate limiting */
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: "Too many requests" },
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* ✅ Routes */
app.use("/collections", collectionsRouter);
app.use("/products", productsRouter);
app.use("/search", searchRouter);
app.use("/menu", menuRouter);
app.use("/auth", authRouter);
app.use("/cart", cartRouter);
app.use("/addresses", addressesRouter);
app.use("/orders", ordersRouter);
app.use("/discounts", discountRouter);
app.use("/tags", tagsRouter);
app.use("/users", userRouter);

/* ✅ 404 handler */
app.use((req, res) => res.status(404).json({ error: "Not Found", path: req.path }));

/* ✅ Centralized error handler */
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";
  const response = { error: message };

  if (process.env.NODE_ENV !== "production") response.stack = err.stack;

  console.error(err);
  res.status(status).json(response);
});

/* ✅ Server startup */
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`✅ API running on http://localhost:${port}`);
});
