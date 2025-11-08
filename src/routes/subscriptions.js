// src/routes/subscriptions.js
import express from "express";
import prisma from "../lib/prisma.js";
import { z } from "zod";
import { isAuthenticated, isAdmin } from "../middleware/auth.js";

const router = express.Router();

// ----------------------- SCHEMAS ----------------------- //

const emailSchema = z.string().email("Invalid email format");

const createSubscriberSchema = z.object({
  email: emailSchema,
  source: z.string().optional()
});

// ----------------------- ROUTES ----------------------- //

// Create new subscriber (public)
router.post("/", async (req, res, next) => {
  try {
    const { email, source } = createSubscriberSchema.parse(req.body);
    
    // Check for existing subscriber
    const existing = await prisma.subscriber.findUnique({
      where: { email }
    });
    
    if (existing) {
      return res.status(400).json({
        error: "Email already subscribed"
      });
    }

    const subscriber = await prisma.subscriber.create({
      data: {
        email,
        source: source || "website",
        verified: false
      }
    });

    res.status(201).json(subscriber);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: "Validation error",
        details: err.errors
      });
    }
    next(err);
  }
});

// Get all subscribers (admin only)
router.get("/", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [subscribers, total] = await Promise.all([
      prisma.subscriber.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" }
      }),
      prisma.subscriber.count()
    ]);

    res.json({
      data: subscribers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
});

// Delete subscriber (admin only)
router.delete("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    await prisma.subscriber.delete({
      where: { id: req.params.id }
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Toggle verification status (admin only)
router.patch("/:id/verify", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const subscriber = await prisma.subscriber.findUnique({
      where: { id: req.params.id }
    });

    if (!subscriber) {
      return res.status(404).json({ error: "Subscriber not found" });
    }

    const updated = await prisma.subscriber.update({
      where: { id: req.params.id },
      data: { verified: !subscriber.verified }
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Export subscribers as CSV (admin only)
router.get("/export", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const subscribers = await prisma.subscriber.findMany({
      orderBy: { createdAt: "desc" }
    });

    const csv = [
      ["Email", "Source", "Verified", "Created At"].join(","),
      ...subscribers.map(sub => [
        sub.email,
        sub.source || "website",
        sub.verified ? "Yes" : "No",
        new Date(sub.createdAt).toISOString()
      ].join(","))
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=subscribers.csv");
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;