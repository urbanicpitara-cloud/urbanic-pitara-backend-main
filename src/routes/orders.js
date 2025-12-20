import { Router } from "express";
import { DiscountType, OrderStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma.js";
import { isAdmin, isAuthenticated } from "../middleware/auth.js";
import { z } from "zod";
import { sendOrderConfirmationEmail } from "../lib/email.js";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisClient } from "../lib/redis.js";

const router = Router();

// Rate limiter for order creation (10 orders per 10 minutes per user)
// Rate limiter for order creation (10 orders per 10 minutes per user)
let orderLimiter;
try {
  orderLimiter = redisClient
    ? rateLimit({
        store: new RedisStore({
          // @ts-expect-error - Known issue with ioredis types
          sendCommand: (...args) => redisClient.call(...args),
        }),
        windowMs: 10 * 60 * 1000, // 10 minutes
        max: 10, // 10 requests per window
        message: "Too many orders created. Please try again in 10 minutes.",
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id || req.ip, // Rate limit by user ID or IP
        // Fail open if Redis is down/limited
        skipFailedRequests: true,
      })
    : (req, res, next) => next(); 
} catch (error) {
  console.error("Rate limiter init failed, falling back to no-op:", error);
  orderLimiter = (req, res, next) => next();
}

// ----------------------- SCHEMAS ----------------------- //

const addressSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  address1: z.string(),
  address2: z.string().optional(),
  city: z.string(),
  province: z.string(),
  zip: z.string(),
  country: z.string(),
  phone: z.string(),
});

// In order controller (backend)

const createOrderSchema = z.object({
  cartId: z.string(),
  shippingAddressId: z.string().optional(),
  billingAddress: addressSchema.optional(),
  shippingAddress: addressSchema.optional(),
  paymentMethod: z.string().optional(),
  discountCode: z.string().optional(),
  // Optional client-side snapshot of cart lines (used as a safe fallback when server cart is empty)
  cartSnapshot: z
    .array(
      z.object({
        productId: z.string().nullable().optional(),
        variantId: z.string().nullable().optional(),
        customProductId: z.string().nullable().optional(),
        quantity: z.number().int().min(1),
        priceAmount: z.number(),
        priceCurrency: z.string(),
      })
    )
    .optional(),
});


const cancelOrderSchema = z.object({
  reason: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum([OrderStatus.PENDING, OrderStatus.DELIVERED,OrderStatus.CANCELED,OrderStatus.PROCESSING,OrderStatus.SHIPPED,OrderStatus.REFUNDED]),
  trackingNumber: z.string().optional(),
  trackingCompany: z.string().optional(),
  notes: z.string().optional(),
});

const updateOrderSchema = z.object({
  status: z.enum(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELED", "REFUNDED"]).optional(),
  trackingNumber: z.string().nullable().optional(),
  trackingCompany: z.string().nullable().optional(),
  adminNotes: z.string().nullable().optional(),
  shippingAddressId: z.string().optional(),
  billingAddressId: z.string().optional(),
});


const bulkUpdateOrdersSchema = z.object({
  orderIds: z.array(z.string()),
  status: z.enum(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELED", "REFUNDED"]).optional(),
  adminNotes: z.string().nullable().optional(),
});

const bulkDeleteOrdersSchema = z.object({
  orderIds: z.array(z.string()),
});

// ----------------------- HELPERS ----------------------- //

const mapOrderItem = (item) => ({
  id: item.id,
  quantity: item.quantity,
  product: item.product ? {
    id: item.product.id,
    title: item.product.title,
    handle: item.product.handle,
    featuredImage: item.product.featuredImageUrl
      ? { url: item.product.featuredImageUrl, altText: item.product.featuredImageAlt }
      : (item.product.images && item.product.images.length > 0)
        ? { url: item.product.images[0].url, altText: item.product.images[0].altText }
        : null,
  } : (item.customProduct ? {
    id: item.customProduct.id,
    title: item.customProduct.title,
    handle: `custom-${item.customProduct.id}`,
    featuredImage: item.customProduct.previewUrl
      ? { url: item.customProduct.previewUrl, altText: item.customProduct.title }
      : null,
  } : null),
  variant: item.variant
    ? { id: item.variant.id, selectedOptions: item.variant.selectedOptions }
    : null,
  customProduct: item.customProduct ? {
    id: item.customProduct.id,
    title: item.customProduct.title,
    color: item.customProduct.color,
    size: item.customProduct.size,
    previewUrl: item.customProduct.previewUrl,
    snapshots: item.customProduct.snapshots,
  } : null,
  price: { amount: item.priceAmount, currencyCode: item.priceCurrency },
  subtotal: {
    amount: (Number(item.priceAmount) * item.quantity).toFixed(2),
    currencyCode: item.priceCurrency,
  },
});

// ----------------------- USER ROUTES ----------------------- //

// Get all orders for authenticated user
router.get("/", isAuthenticated, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      orderBy: { placedAt: "desc" },
      include: {
        items: { include: { product: { include: { images: { take: 1 } } }, variant: true, customProduct: true } },
        shippingAddress: true,
        billingAddress: true,
        payment: true,
      },
    });

    res.json(
      orders.map((order) => ({
        id: order.id,
        status: order.status,
        createdAt: order.placedAt,
        totalAmount: order.totalAmount,
        totalCurrency: order.totalCurrency,
        shippingAddress: order.shippingAddress,
        billingAddress: order.billingAddress,
        payment: order.payment ? {
          id: order.payment.id,
          status: order.payment.status,
          method: order.payment.method,
          provider: order.payment.provider,
          amount: order.payment.amount,
          currency: order.payment.currency,
          createdAt: order.payment.createdAt,
        } : null,
        items: order.items.map(mapOrderItem),
      }))
    );
  } catch (error) {
    next(error);
  }
});

// Get order by ID (accessible to admin or the user who owns it)
router.get("/:id", isAuthenticated, async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        items: { include: { product: { include: { images: { take: 1 } } }, variant: true, customProduct: true } },
        shippingAddress: true,
        billingAddress: true,
        payment: true,
      },
    });

    if (!order) return res.status(404).json({ error: "Order not found bhai" });

    // 🔐 Security: allow if admin OR order belongs to the current user
    if (!req.user.isAdmin && order.userId !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to view this order" });
    }

    res.json({
      id: order.id,
      status: order.status,
      createdAt: order.placedAt,
      totalAmount: order.totalAmount,
      totalCurrency: order.totalCurrency,
      user: order.user,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      payment: order.payment ? {
        id: order.payment.id,
        status: order.payment.status,
        method: order.payment.method,
        provider: order.payment.provider,
        providerOrderId: order.payment.providerOrderId,
        providerPaymentId: order.payment.providerPaymentId,
        amount: order.payment.amount,
        currency: order.payment.currency,
        createdAt: order.payment.createdAt,
        rawResponse: order.payment.rawResponse,
        refundId: order.payment.refundId,
        refundAmount: order.payment.refundAmount,
        refundedAt: order.payment.refundedAt,
        refundReason: order.payment.refundReason,
      } : null,
      items: order.items.map(mapOrderItem),
      trackingNumber: order.trackingNumber,
      trackingCompany: order.trackingCompany,
      adminNotes: order.adminNotes,
    });
  } catch (error) {
    next(error);
  }
});


router.post("/", isAuthenticated, orderLimiter, async (req, res, next) => {
  try {
    const parsed = createOrderSchema.extend({
      discountCode: z.string().nullable().optional(),
    }).parse(req.body);

    const { cartId, shippingAddress, billingAddress, shippingAddressId, billingAddressId, paymentMethod, discountCode } = parsed;

    // ----------- FETCH CART -----------------
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { lines: { include: { product: true, variant: true, customProduct: true } } },
    });

    if (!cart) return res.status(404).json({ error: "Cart not found" });
    if (cart.userId && cart.userId !== req.user.id)
      return res.status(403).json({ error: "Not authorized to access this cart" });

    // If server cart is empty, allow an optional client-provided snapshot as a fallback.
    // This helps when the client has an up-to-date cart UI but the server cart is stale
    // (for example when using client-side carts). The snapshot must be provided by the client
    // and will be used only when server cart has no lines.
    let cartLinesSource = cart.lines;

    if ((!cart.lines || cart.lines.length === 0) && parsed.cartSnapshot && parsed.cartSnapshot.length > 0) {
      cartLinesSource = parsed.cartSnapshot.map((s) => ({
        productId: s.productId || null,
        variantId: s.variantId || null,
        customProductId: s.customProductId || null,
        quantity: s.quantity,
        priceAmount: s.priceAmount,
        priceCurrency: s.priceCurrency,
      }));
    }

    if (!cartLinesSource || cartLinesSource.length === 0) {
      return res.status(400).json({
        error: "Cart is empty",
        cart: { id: cart.id, totalQuantity: cart.totalQuantity, linesCount: cart.lines.length },
      });
    }

    let subtotal = cartLinesSource.reduce(
      (sum, line) => sum + Number(line.priceAmount) * line.quantity,
      0
    );
    const currency = cartLinesSource[0].priceCurrency;
    let discountAmount = 0;
    let appliedDiscount = null;

    // ----------------- CHECK DISCOUNT CODE -----------------
    if (discountCode) {
      const discount = await prisma.discount.findFirst({
        where: {
          code: discountCode,
          active: true,
          startsAt: { lte: new Date() },
          OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }],
        },
      });

      if (discount) {
        // ✅ CHECK USAGE LIMIT
        if (discount.usageLimit !== null) {
          const usedCount = await prisma.order.count({
            where: { appliedDiscountId: discount.id },
          });
          
          if (usedCount >= discount.usageLimit) {
            return res.status(400).json({ 
              error: "Discount code usage limit has been reached" 
            });
          }
        }

        if (discount.type === DiscountType.PERCENTAGE) {
          discountAmount = (subtotal * Number(discount.value)) / 100;
          subtotal -= discountAmount;
        } else if (discount.type === DiscountType.FIXED) {
          discountAmount = Math.min(Number(discount.value), subtotal);
          subtotal -= discountAmount;
        }
        appliedDiscount = discount;
      }
    }

    // ----------------- ADD COD SURCHARGE -----------------
    const COD_SURCHARGE = 100; // ₹100 COD fee
    if (paymentMethod && paymentMethod.toUpperCase() === "COD") {
      subtotal += COD_SURCHARGE;
    }

    const totalAmount = subtotal.toFixed(2);
    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // ----------------- TRANSACTION -----------------
    const orderWithPayment = await prisma.$transaction(async (tx) => {
      let shippingAddrId;
      let billingAddrId;

      // ----------------- SHIPPING ADDRESS -----------------
      if (shippingAddressId) {
        shippingAddrId = shippingAddressId;
      } else if (shippingAddress) {
        const newShipping = await tx.address.create({ data: { ...shippingAddress, userId: req.user.id } });
        shippingAddrId = newShipping.id;
      } else {
        throw new Error("Shipping address required");
      }

      // ----------------- BILLING ADDRESS -----------------
      if (billingAddressId) {
        billingAddrId = billingAddressId;
      } else if (billingAddress) {
        const newBilling = await tx.address.create({ data: { ...billingAddress, userId: req.user.id } });
        billingAddrId = newBilling.id;
      } else {
        billingAddrId = shippingAddrId;
      }

      // ----------------- CREATE ORDER -----------------
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          userId: req.user.id,
          status: OrderStatus.PENDING,
          totalAmount,
          totalCurrency: currency,
          shippingAddressId: shippingAddrId,
          billingAddressId: billingAddrId,
          ...(appliedDiscount && {
            appliedDiscountId: appliedDiscount.id,
            discountAmount: discountAmount.toFixed(2),
          }),
          items: {
            create: cartLinesSource.map((line) => ({
              productId: line.productId || null,
              variantId: line.variantId || null,
              customProductId: line.customProductId || null,
              quantity: line.quantity,
              priceAmount: new Prisma.Decimal(line.priceAmount),
              priceCurrency: line.priceCurrency,
            })),
          },
        },
        include: {
          items: { include: { product: { include: { images: { take: 1 } } }, variant: true, customProduct: true } },
          shippingAddress: true,
          billingAddress: true,
          appliedDiscount: true,
          user: true,
        },
      });

      // ✅ DECREMENT PRODUCT QUANTITIES FOR EACH ORDER ITEM (skip custom products)
      for (const item of cartLinesSource) {
        // Skip custom products - they don't have inventory to manage
        if (item.customProductId) {
          continue;
        }
        
        if (item.variantId) {
          // If variant exists, decrement variant quantity
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: {
              inventoryQuantity: {
                decrement: item.quantity,
              },
            },
          });
        } else if (item.productId) {
          // If no variant, find the first variant of the product and decrement
          const variant = await tx.productVariant.findFirst({
            where: { productId: item.productId },
          });
          if (variant) {
            await tx.productVariant.update({
              where: { id: variant.id },
              data: {
                inventoryQuantity: {
                  decrement: item.quantity,
                },
              },
            });
          }
        }
      }

      // ----------------- CREATE PAYMENT -----------------
      // Payment status: for COD and external providers (e.g. PHONEPE) mark as INITIATED.
      // For legacy/non-external methods we may mark as PAID. This prevents marking
      // external-provider payments as paid before callback verification.
      const methodUpper = (paymentMethod || "COD").toUpperCase();
      const isExternalProvider = methodUpper === "PHONEPE";

      const newPayment = await tx.payment.create({
        data: {
          orderId: newOrder.id,
          method: methodUpper || "COD",
          provider: isExternalProvider ? "PHONEPE" : null,
          amount: new Prisma.Decimal(totalAmount),
          currency,
          status: methodUpper === "COD" || isExternalProvider ? "INITIATED" : "PAID",
        },
      });

      // ----------------- CLEAR CART -----------------
      // Only clear server-side cart if it actually had lines. If we used a client snapshot
      // there is nothing to clear on the server.
      if (cart.lines && cart.lines.length > 0) {
        await tx.cartLine.deleteMany({ where: { cartId } });
        await tx.cart.update({ where: { id: cartId }, data: { totalQuantity: 0 } });
      }

      return { ...newOrder, payment: newPayment };
    });

    // ----------------- SEND EMAIL -----------------
    sendOrderConfirmationEmail(orderWithPayment).catch(err => console.error("Failed to send order confirmation email:", err));

    // ----------------- RESPONSE -----------------
    res.status(201).json({
      id: orderWithPayment.id,
      status: orderWithPayment.status,
      createdAt: orderWithPayment.placedAt,
      totalAmount: orderWithPayment.totalAmount,
      totalCurrency: orderWithPayment.totalCurrency,
      discount: orderWithPayment.appliedDiscount
        ? { code: orderWithPayment.appliedDiscount.code, amount: orderWithPayment.discountAmount }
        : null,
      payment: {
        method: orderWithPayment.payment.method,
        status: orderWithPayment.payment.status,
        amount: orderWithPayment.payment.amount,
        currency: orderWithPayment.payment.currency,
      },
      shippingAddress: orderWithPayment.shippingAddress,
      billingAddress: orderWithPayment.billingAddress,
      items: orderWithPayment.items.map(mapOrderItem),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    next(error);
  }
});



// Cancel an order
router.post("/:id/cancel", isAuthenticated, async (req, res, next) => {
  try {
    const parsed = cancelOrderSchema.parse(req.body);
    const { id } = req.params;
    const { reason } = parsed;

    const order = await prisma.order.findFirst({ 
      where: { id, userId: req.user.id },
      include: { items: { include: { product: { include: { images: { take: 1 } } }, variant: true, customProduct: true } } },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!["PENDING", "PROCESSING"].includes(order.status))
      return res.status(400).json({ error: "Cannot cancel order in its current status" });

    // ✅ RESTORE PRODUCT QUANTITIES IN TRANSACTION
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Restore inventory for each order item (skip custom products)
      for (const item of order.items) {
        // Skip custom products - they don't have inventory to manage
        if (item.customProductId) {
          continue;
        }
        
        if (item.variantId) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: {
              inventoryQuantity: {
                increment: item.quantity,
              },
            },
          });
        } else if (item.productId) {
          // Find variant by product and restore
          const variant = await tx.productVariant.findFirst({
            where: { productId: item.productId },
          });
          if (variant) {
            await tx.productVariant.update({
              where: { id: variant.id },
              data: {
                inventoryQuantity: {
                  increment: item.quantity,
                },
              },
            });
          }
        }
      }

      // Update order status to CANCELED
      return await tx.order.update({
        where: { id },
        data: { status: "CANCELED", cancelReason: reason || "Canceled by customer" },
        include: {
          items: { include: { product: true, variant: true } },
          shippingAddress: true,
          billingAddress: true,
        },
      });
    });

    res.json({
      id: updatedOrder.id,
      status: updatedOrder.status,
      createdAt: updatedOrder.placedAt,
      totalAmount: updatedOrder.totalAmount,
      totalCurrency: updatedOrder.totalCurrency,
      cancelReason: updatedOrder.cancelReason,
      shippingAddress: updatedOrder.shippingAddress,
      billingAddress: updatedOrder.billingAddress,
      items: updatedOrder.items.map(mapOrderItem),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
    next(error);
  }
});

// ----------------------- ADMIN ROUTES ----------------------- //

// Get all orders with pagination OR all at once
router.get("/admin/all", isAuthenticated,isAdmin, async (req, res, next) => {
  try {
    
    const { status, page = 1, limit = 10, all,images=false } = req.query;
    const where = {};
    if (status) where.status = status;

    // 🧠 Determine if user requested all data
    const fetchAll = all === "true" || limit === "all";

    const skip = fetchAll ? 0 : (parseInt(page) - 1) * parseInt(limit);
    const take = fetchAll ? undefined : parseInt(limit);

    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { placedAt: "desc" },
        skip,
        take,
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          items: { include: { product: { include: { images: { take: 1 } } }, variant: true, customProduct: true } },
          shippingAddress: true,
          billingAddress: true,
          payment: true,
        },
      }),
      // prisma.order.count({ where }),
    ]);

    res.json({
      orders: orders.map((order) => ({
        id: order.id,
        status: order.status,
        createdAt: order.placedAt,
        totalAmount: order.totalAmount,
        totalCurrency: order.totalCurrency,
        user: order.user,
        shippingAddress: order.shippingAddress,
        billingAddress: order.billingAddress,
        payment: order.payment ? {
          id: order.payment.id,
          status: order.payment.status,
          method: order.payment.method,
          provider: order.payment.provider,
          providerOrderId: order.payment.providerOrderId,
          providerPaymentId: order.payment.providerPaymentId,
          amount: order.payment.amount,
          currency: order.payment.currency,
          createdAt: order.payment.createdAt,
        } : null,
        items: order.items.map(mapOrderItem),
      })),
      pagination: fetchAll
        ? null
        : {
            total: totalCount,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(totalCount / parseInt(limit)),
          },
    });
  } catch (error) {
    next(error);
  }
});



router.delete("/admin/bulk-delete", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const parsed = bulkDeleteOrdersSchema.parse(req.body);
    const { orderIds } = parsed;

    if (!orderIds || orderIds.length === 0) {
      return res.status(400).json({ error: "No order IDs provided" });
    }

    // Delete orders and their related items
    const result = await prisma.$transaction(async (tx) => {
      // First delete order items
      await tx.orderItem.deleteMany({
        where: { orderId: { in: orderIds } },
      });

      // Then delete payments
      await tx.payment.deleteMany({
        where: { orderId: { in: orderIds } },
      });

      // Finally delete orders
      const deletedOrders = await tx.order.deleteMany({
        where: { id: { in: orderIds } },
      });

      return deletedOrders;
    });

    res.json({
      message: `${result.count} order(s) deleted successfully`,
      count: result.count,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
    next(error);
  }
});

router.put("/admin/bulk-update", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const parsed = bulkUpdateOrdersSchema.parse(req.body);

    const { orderIds, ...data } = parsed;

    const updatedOrders = await prisma.order.updateMany({
      where: { id: { in: orderIds } },
      data,
    });

    res.json({
      message: `${updatedOrders.count} orders updated successfully`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
    next(error);
  }
});



router.put("/admin/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const parsed = updateOrderSchema.parse(req.body);
    const { id } = req.params;

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: parsed,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        items: { include: { product: { include: { images: { take: 1 } } }, variant: true, customProduct: true } },
        shippingAddress: true,
        billingAddress: true,
        payment: true,
      },
    });

    res.json({
      id: updatedOrder.id,
      status: updatedOrder.status,
      createdAt: updatedOrder.placedAt,
      totalAmount: updatedOrder.totalAmount,
      totalCurrency: updatedOrder.totalCurrency,
      trackingNumber: updatedOrder.trackingNumber,
      trackingCompany: updatedOrder.trackingCompany,
      adminNotes: updatedOrder.adminNotes,
      user: updatedOrder.user,
      shippingAddress: updatedOrder.shippingAddress,
      billingAddress: updatedOrder.billingAddress,
      payment: updatedOrder.payment ? {
        id: updatedOrder.payment.id,
        status: updatedOrder.payment.status,
        method: updatedOrder.payment.method,
        provider: updatedOrder.payment.provider,
        amount: updatedOrder.payment.amount,
        currency: updatedOrder.payment.currency,
        createdAt: updatedOrder.payment.createdAt,
      } : null,
      items: updatedOrder.items.map(mapOrderItem),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
    next(error);
  }
});





// Update order status (admin)
router.post("/admin/:id/invoice", isAuthenticated, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Not authorized" });
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        items: { include: { product: true, variant: true, customProduct: true } },
        shippingAddress: true,
      },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    // Send invoice
    await sendOrderConfirmationEmail(order);

    res.json({ success: true, message: "Invoice sent successfully" });
  } catch (error) {
    next(error);
  }
});


// Update order status (admin)
router.put("/admin/:id/status", isAuthenticated, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Not authorized" });

    const parsed = updateStatusSchema.parse(req.body);
    const { id } = req.params;

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: parsed.status,
        trackingNumber: parsed.trackingNumber || null,
        trackingCompany: parsed.trackingCompany || null,
        adminNotes: parsed.notes || null,
      },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        items: { include: { product: { include: { images: { take: 1 } } }, variant: true, customProduct: true } },
        shippingAddress: true,
        billingAddress: true,
      },
    });

    res.json({
      id: updatedOrder.id,
      status: updatedOrder.status,
      createdAt: updatedOrder.placedAt,
      totalAmount: updatedOrder.totalAmount,
      totalCurrency: updatedOrder.totalCurrency,
      trackingNumber: updatedOrder.trackingNumber,
      trackingCompany: updatedOrder.trackingCompany,
      adminNotes: updatedOrder.adminNotes,
      user: updatedOrder.user,
      shippingAddress: updatedOrder.shippingAddress,
      billingAddress: updatedOrder.billingAddress,
      items: updatedOrder.items.map(mapOrderItem),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
    next(error);
  }
});

export default router;
