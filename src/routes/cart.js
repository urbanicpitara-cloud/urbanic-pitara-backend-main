import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

/** Utility to include full cart with related models */
const cartInclude = {
  lines: {
    include: {
      product: { include: { images: true } },
      variant: true,
    },
  },
};

/** 🧮 Utility: format cart response */
const formatCart = (cart) => {
  const subtotal = cart.lines.reduce(
    (sum, l) => sum + parseFloat(l.priceAmount) * l.quantity,
    0
  );
  const currency =
    cart.lines.length > 0 ? cart.lines[0].priceCurrency : "INR";

  return {
    id: cart.id,
    totalQuantity: cart.totalQuantity,
    subtotal: { amount: subtotal.toFixed(2), currencyCode: currency },
    lines: cart.lines.map((l) => ({
      id: l.id,
      quantity: l.quantity,
      product: {
        id: l.product.id,
        title: l.product.title,
        handle: l.product.handle,
        featuredImage: l.product.featuredImageUrl
          ? {
              url: l.product.featuredImageUrl,
              altText: l.product.featuredImageAlt,
            }
          : l.product.images[0]
          ? {
              url: l.product.images[0].url,
              altText: l.product.images[0].altText,
            }
          : null,
      },
      variant: l.variant
        ? {
            id: l.variant.id,
            selectedOptions: l.variant.selectedOptions,
          }
        : null,
      price: {
        amount: l.priceAmount,
        currencyCode: l.priceCurrency,
      },
      subtotal: {
        amount: (parseFloat(l.priceAmount) * l.quantity).toFixed(2),
        currencyCode: l.priceCurrency,
      },
    })),
  };
};

/** 🧩 Helper: get or create cart (guest or user) */
const getOrCreateCart = async (userId = null) => {
  if (userId) {
    let cart = await prisma.cart.findFirst({
      where: { userId },
      include: cartInclude,
    });
    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId },
        include: cartInclude,
      });
    }
    return cart;
  }

  return await prisma.cart.create({ data: {}, include: cartInclude });
};

/**
 * 🛒 GET CART
 */
router.get("/", async (req, res, next) => {
  try {
    const cartId = req.query.cartId || req.cookies.cartId;
    const userId = req.user?.id || null;
    let cart = null;

    if (cartId) {
      cart = await prisma.cart.findUnique({ where: { id: cartId }, include: cartInclude });

      // Link user if logged in
      if (cart && userId && !cart.userId) {
        cart = await prisma.cart.update({
          where: { id: cart.id },
          data: { userId },
          include: cartInclude,
        });
      }
    }

    if (!cart) {
      cart = await getOrCreateCart(userId);
      if (!userId) {
        res.cookie("cartId", cart.id, {
          maxAge: 30 * 24 * 60 * 60 * 1000,
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
        });
      }
    }

    res.json(formatCart(cart));
  } catch (err) {
    next(err);
  }
});

/**
 * ➕ ADD ITEM TO CART
 */
router.post("/lines", async (req, res, next) => {
  try {
    const { productId, variantId, quantity = 1 } = req.body;
    const cartId = req.body.cartId || req.cookies.cartId;
    const userId = req.user?.id || null;

    if (!productId) return res.status(400).json({ error: "Product ID is required" });
    if (quantity <= 0) return res.status(400).json({ error: "Quantity must be positive" });

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    let variant = null;
    if (variantId) {
      variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
      if (!variant || variant.productId !== productId)
        return res.status(404).json({ error: "Invalid variant" });
      if (!variant.availableForSale || variant.inventoryQuantity < quantity)
        return res.status(400).json({ error: "Variant unavailable or out of stock" });
    }

    let cart = cartId
      ? await prisma.cart.findUnique({ where: { id: cartId } })
      : null;
    if (!cart) {
      cart = await getOrCreateCart(userId);
      if (!userId) {
        res.cookie("cartId", cart.id, {
          maxAge: 30 * 24 * 60 * 60 * 1000,
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.cartLine.findFirst({
        where: { cartId: cart.id, productId, variantId: variantId || null },
      });

      if (existing) {
        await tx.cartLine.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + quantity },
        });
      } else {
        await tx.cartLine.create({
          data: {
            cartId: cart.id,
            productId,
            variantId: variantId || null,
            quantity,
            priceAmount: variant ? variant.priceAmount : product.minPriceAmount,
            priceCurrency: variant ? variant.priceCurrency : product.minPriceCurrency,
          },
        });
      }

      const total = await tx.cartLine.aggregate({
        where: { cartId: cart.id },
        _sum: { quantity: true },
      });

      await tx.cart.update({
        where: { id: cart.id },
        data: { totalQuantity: total._sum.quantity || 0 },
      });
    });

    const updated = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
    res.json(formatCart(updated));
  } catch (err) {
    next(err);
  }
});

/**
 * ✏️ UPDATE CART LINE
 */
router.put("/lines/:lineId", async (req, res, next) => {
  try {
    const { lineId } = req.params;
    const { quantity } = req.body;
    const cartId = req.body.cartId || req.cookies.cartId;

    if (!cartId) return res.status(400).json({ error: "Cart ID required" });
    if (quantity == null || quantity < 0)
      return res.status(400).json({ error: "Valid quantity required" });

    await prisma.$transaction(async (tx) => {
      const line = await tx.cartLine.findUnique({ where: { id: lineId } });
      if (!line || line.cartId !== cartId)
        throw new Error("Cart line not found");

      if (quantity === 0) {
        await tx.cartLine.delete({ where: { id: lineId } });
      } else {
        await tx.cartLine.update({ where: { id: lineId }, data: { quantity } });
      }

      const total = await tx.cartLine.aggregate({
        where: { cartId },
        _sum: { quantity: true },
      });
      await tx.cart.update({
        where: { id: cartId },
        data: { totalQuantity: total._sum.quantity || 0 },
      });
    });

    const updated = await prisma.cart.findUnique({ where: { id: cartId }, include: cartInclude });
    res.json(formatCart(updated));
  } catch (err) {
    next(err);
  }
});

/**
 * ❌ REMOVE CART LINE
 */
router.delete("/lines/:lineId", async (req, res, next) => {
  try {
    const { lineId } = req.params;
    const cartId = req.query.cartId || req.cookies.cartId;
    if (!cartId) return res.status(400).json({ error: "Cart ID required" });

    await prisma.$transaction(async (tx) => {
      const line = await tx.cartLine.findUnique({ where: { id: lineId } });
      if (!line || line.cartId !== cartId)
        throw new Error("Cart line not found");

      await tx.cartLine.delete({ where: { id: lineId } });

      const total = await tx.cartLine.aggregate({
        where: { cartId },
        _sum: { quantity: true },
      });
      await tx.cart.update({
        where: { id: cartId },
        data: { totalQuantity: total._sum.quantity || 0 },
      });
    });

    const updated = await prisma.cart.findUnique({ where: { id: cartId }, include: cartInclude });
    res.json(formatCart(updated));
  } catch (err) {
    next(err);
  }
});

export default router;
