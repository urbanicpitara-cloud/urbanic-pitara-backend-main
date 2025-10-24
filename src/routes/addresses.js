import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { isAuthenticated as requireAuth } from "../middleware/auth.js";

const router = Router();

/**
 * 🏠 Get all addresses for the logged-in user
 */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const addresses = await prisma.address.findMany({
      where: { userId: req.user.id },
      orderBy: { isDefault: "desc" },
    });

    res.json({ items: addresses });
  } catch (err) {
    next(err);
  }
});

/**
 * ➕ Create a new address
 */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      firstName: z.string().min(1, "First name is required"),
      lastName: z.string().min(1, "Last name is required"),
      address1: z.string().min(1, "Address line 1 is required"),
      address2: z.string().optional(),
      city: z.string().min(1, "City is required"),
      province: z.string().optional(),
      zip: z.string().optional(),
      country: z.string().min(1, "Country is required"),
      phone: z.string().optional(),
      isDefault: z.boolean().optional(),
    });

    const result = schema.safeParse(req.body);
    if (!result.success)
      return res.status(400).json({ error: "Invalid body", details: result.error.errors });

    const { isDefault, ...data } = result.data;

    // If setting as default, unset other defaults for the user
    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId: req.user.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.create({
      data: {
        ...data,
        userId: req.user.id,
        isDefault: !!isDefault,
      },
    });

    res.status(201).json(address);
  } catch (err) {
    next(err);
  }
});

/**
 * ✏️ Update an existing address
 */
router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const paramSchema = z.object({ id: z.string().min(1) });
    const bodySchema = z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      address1: z.string().optional(),
      address2: z.string().optional(),
      city: z.string().optional(),
      province: z.string().optional(),
      zip: z.string().optional(),
      country: z.string().optional(),
      phone: z.string().optional(),
      isDefault: z.boolean().optional(),
    });

    const params = paramSchema.safeParse(req.params);
    const body = bodySchema.safeParse(req.body);

    if (!params.success)
      return res.status(400).json({ error: "Invalid ID", details: params.error.errors });
    if (!body.success)
      return res.status(400).json({ error: "Invalid body", details: body.error.errors });

    // Ensure the address belongs to the logged-in user
    const existing = await prisma.address.findUnique({
      where: { id: params.data.id },
    });
    if (!existing || existing.userId !== req.user.id)
      return res.status(404).json({ error: "Address not found" });

    // Handle default flag
    if (body.data.isDefault) {
      await prisma.address.updateMany({
        where: { userId: req.user.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.address.update({
      where: { id: params.data.id },
      data: body.data,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * 🗑️ Delete an address
 */
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const params = z.object({ id: z.string().min(1) }).safeParse(req.params);
    if (!params.success)
      return res.status(400).json({ error: "Invalid ID", details: params.error.errors });

    // Verify ownership
    const existing = await prisma.address.findUnique({
      where: { id: params.data.id },
    });
    if (!existing || existing.userId !== req.user.id)
      return res.status(404).json({ error: "Address not found" });

    await prisma.address.delete({
      where: { id: params.data.id },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
