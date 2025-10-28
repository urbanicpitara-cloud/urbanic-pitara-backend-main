import { Router } from "express";
import { DiscountType, Prisma } from "@prisma/client";
import prisma from "../lib/prisma.js";
import { isAuthenticated } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

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
  shippingAddressId: z.string().optional(), // <- changed from shippingAddress
  billingAddress: addressSchema.optional(),
  shippingAddress: addressSchema.optional(),
  paymentMethod: z.string().optional(),
  discountCode: z.string().optional(),

});


const cancelOrderSchema = z.object({
  reason: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["pending", "processing", "shipped", "delivered", "canceled", "refunded"]),
  trackingNumber: z.string().optional(),
  trackingCompany: z.string().optional(),
  notes: z.string().optional(),
});

// ----------------------- HELPERS ----------------------- //

const mapOrderItem = (item) => ({
  id: item.id,
  quantity: item.quantity,
  product: {
    id: item.product.id,
    title: item.product.title,
    handle: item.product.handle,
    featuredImage: item.product.featuredImageUrl
      ? { url: item.product.featuredImageUrl, altText: item.product.featuredImageAlt }
      : null,
  },
  variant: item.variant
    ? { id: item.variant.id, selectedOptions: item.variant.selectedOptions }
    : null,
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
        items: { include: { product: true, variant: true } },
        shippingAddress: true,
        billingAddress: true,
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
        items: order.items.map(mapOrderItem),
      }))
    );
  } catch (error) {
    next(error);
  }
});

// Get specific order by ID
router.get("/:id", isAuthenticated, async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await prisma.order.findFirst({
      where: { id, userId: req.user.id },
      include: {
        items: { include: { product: true, variant: true } },
        shippingAddress: true,
        billingAddress: true,
      },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    res.json({
      id: order.id,
      status: order.status,
      createdAt: order.placedAt,
      totalAmount: order.totalAmount,
      totalCurrency: order.totalCurrency,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      items: order.items.map(mapOrderItem),
    });
  } catch (error) {
    next(error);
  }
});


router.post("/", isAuthenticated, async (req, res, next) => {
  try {
    const parsed = createOrderSchema.extend({
      discountCode: z.string().optional(),
    }).parse(req.body);

    const { cartId, shippingAddress, billingAddress, shippingAddressId, billingAddressId, paymentMethod, discountCode } = parsed;

    // ----------------- FETCH CART -----------------
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { lines: { include: { product: true, variant: true } } },
    });

    if (!cart) return res.status(404).json({ error: "Cart not found" });
    if (cart.userId && cart.userId !== req.user.id)
      return res.status(403).json({ error: "Not authorized to access this cart" });
    if (cart.lines.length === 0) return res.status(400).json({ error: "Cart is empty" });

    let subtotal = cart.lines.reduce(
      (sum, line) => sum + Number(line.priceAmount) * line.quantity,
      0
    );
    const currency = cart.lines[0].priceCurrency;
    let discountAmount = 0;
    let appliedDiscount = null;


    // ----------------- CHECK DISCOUNT CODE -----------------
    if (discountCode) {
      const discount = await prisma.discount.findFirst({
        where: {
          code: discountCode,
          active: true,
          startsAt: { lte: new Date() },
          OR: [
            { endsAt: null },
            { endsAt: { gte: new Date() } },
          ],
        },
      });

        
        if (discount) {
          if (discount.type === DiscountType.PERCENTAGE) {
          discountAmount = (subtotal * Number(discount.value)) / 100;
          subtotal = subtotal - (subtotal * Number(discount.value)) / 100;
        } else if (discount.type === DiscountType.FIXED) {
          subtotal = Math.max(subtotal - Number(discount.value));
          discountAmount = Math.max(discount.value,0);
        }


        appliedDiscount = discount;
      }
    }
    const totalAmount = subtotal.toFixed(2);
    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // ----------------- TRANSACTION -----------------
    const order = await prisma.$transaction(async (tx) => {
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
          status: "pending",
          totalAmount,
          totalCurrency: currency,
          paymentMethod: paymentMethod || "cod",
          shippingAddressId: shippingAddrId,
          billingAddressId: billingAddrId,
          ...(appliedDiscount && {
            appliedDiscountId: appliedDiscount.id,
            discountAmount: discountAmount.toFixed(2),
          }),
          items: {
            create: cart.lines.map((line) => ({
              productId: line.productId,
              variantId: line.variantId,
              quantity: line.quantity,
              priceAmount: new Prisma.Decimal(line.priceAmount),
              priceCurrency: line.priceCurrency,
            })),
          },
        },
        include: {
          items: { include: { product: true, variant: true } },
          shippingAddress: true,
          billingAddress: true,
          appliedDiscount: true,
        },
      });

      // Clear cart
      await tx.cartLine.deleteMany({ where: { cartId } });
      await tx.cart.update({ where: { id: cartId }, data: { totalQuantity: 0 } });

      return newOrder;
    });

    // ----------------- RESPONSE -----------------
    res.status(201).json({
      id: order.id,
      status: order.status,
      createdAt: order.placedAt,
      totalAmount: order.totalAmount,
      totalCurrency: order.totalCurrency,
      discount: order.appliedDiscount
        ? {
            code: order.appliedDiscount.code,
            amount: order.discountAmount,
          }
        : null,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      items: order.items.map(mapOrderItem),
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

    const order = await prisma.order.findFirst({ where: { id, userId: req.user.id } });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!["pending", "processing"].includes(order.status))
      return res.status(400).json({ error: "Cannot cancel order in its current status" });

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: { status: "canceled", cancelReason: reason || "Canceled by customer" },
      include: {
        items: { include: { product: true, variant: true } },
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

// Get all orders with pagination
router.get("/admin/all", isAuthenticated, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Not authorized" });

    const { status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { placedAt: "desc" },
        skip,
        take: parseInt(limit),
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          items: { include: { product: true, variant: true } },
          shippingAddress: true,
          billingAddress: true,
        },
      }),
      prisma.order.count({ where }),
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
        items: order.items.map(mapOrderItem),
      })),
      pagination: {
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
        items: { include: { product: true, variant: true } },
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
