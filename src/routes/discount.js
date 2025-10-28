import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAuthenticated } from "../middleware/auth.js";

const router = Router();

/**
 * 💸 Validate discount code (frontend)
 * Called from checkout page to preview applied discount.
 */
router.post("/validate", async (req, res, next) => {
  try {
    const { code, orderAmount } = req.body;

    if (!code) return res.status(400).json({ error: "Discount code is required" });

    const discount = await prisma.discount.findUnique({
      where: { code: code.trim().toUpperCase() },
    });

    if (
      !discount ||
      !discount.active ||
      (discount.startsAt && discount.startsAt > new Date()) ||
      (discount.endsAt && discount.endsAt < new Date())
    ) {
      return res.status(400).json({ error: "Invalid or expired discount code" });
    }

    // check min order amount
    if (
      discount.minOrderAmount &&
      parseFloat(orderAmount) < parseFloat(discount.minOrderAmount)
    ) {
      return res.status(400).json({
        error: `Minimum order amount for this discount is ${discount.minOrderAmount}`,
      });
    }

    res.json({
      message: "Discount applied successfully",
      discount: {
        code: discount.code,
        type: discount.type,
        value: discount.value,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 💰 Calculate discounted total
 * (Can be called on checkout confirm or internally in createOrder)
 */
export function applyDiscount(totalAmount, discount) {
  if (!discount) return totalAmount;

  const total = parseFloat(totalAmount);
  const value = parseFloat(discount.value);

  if (discount.type === "PERCENTAGE") {
    return Math.max(total - total * (value / 100), 0);
  } else if (discount.type === "FIXED") {
    return Math.max(total - value, 0);
  }
  return total;
}

/**
 * 🧑‍💼 ADMIN: Create a new discount
 */
router.post("/create", isAuthenticated, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Not authorized" });

    const { code, description, type, value, minOrderAmount, startsAt, endsAt } = req.body;

    const discount = await prisma.discount.create({
      data: {
        code: code.trim().toUpperCase(),
        description,
        type,
        value,
        minOrderAmount,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
      },
    });

    res.status(201).json(discount);
  } catch (err) {
    next(err);
  }
});

/**
 * 🧾 ADMIN: List all discounts
 */
router.get("/all", isAuthenticated, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Not authorized" });
    const discounts = await prisma.discount.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(discounts);
  } catch (err) {
    next(err);
  }
});

/**
 * ✏️ ADMIN: Update discount
 */
router.patch("/:id", isAuthenticated, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Not authorized" });

    const { id } = req.params;
    const { description, active, value, type, minOrderAmount, startsAt, endsAt } = req.body;

    const updated = await prisma.discount.update({
      where: { id },
      data: {
        description,
        active,
        value,
        type,
        minOrderAmount,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * ❌ ADMIN: Delete discount
 */
router.delete("/:id", isAuthenticated, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Not authorized" });

    await prisma.discount.delete({ where: { id: req.params.id } });
    res.json({ message: "Discount deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
