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
    const verified = req.query.verified; // 'true', 'false', or undefined

    const where = {};
    if (verified === 'true') where.verified = true;
    if (verified === 'false') where.verified = false;

    const [subscribers, total] = await Promise.all([
      prisma.subscriber.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" }
      }),
      prisma.subscriber.count({ where })
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

// Bulk delete subscribers
router.delete("/", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No IDs provided" });
    }

    await prisma.subscriber.deleteMany({
      where: { id: { in: ids } }
    });

    res.json({ message: "Subscribers deleted successfully" });
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

// Send email to subscribers (admin only)
router.post("/admin/email", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { ids, subject, message, isHtml, selectAll, filterVerified } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ error: "Subject and message are required" });
    }

    let targetEmails = [];

    if (selectAll) {
      const where = {};
      if (filterVerified === 'true') where.verified = true;
      if (filterVerified === 'false') where.verified = false;

      const subscribers = await prisma.subscriber.findMany({
        where,
        select: { email: true }
      });
      targetEmails = subscribers.map(s => s.email);
    } else if (Array.isArray(ids) && ids.length > 0) {
      const subscribers = await prisma.subscriber.findMany({
        where: { id: { in: ids } },
        select: { email: true }
      });
      targetEmails = subscribers.map(s => s.email);
    } else {
      return res.status(400).json({ error: "No recipients selected" });
    }

    if (targetEmails.length === 0) {
      return res.status(404).json({ error: "No subscribers found to email" });
    }

    // In production, use a queue. For now, we'll try to process safely.
    // Importing dynamically to avoid circular dependency issues if any, though not strictly needed here.
    const { sendCustomEmail } = await import("../lib/email.js");

    // Process in chunks or just fire and forget if the list isn't huge.
    // We'll use Promise.allSettled
    Promise.allSettled(
      targetEmails.map(email => 
        sendCustomEmail({
          to: email,
          subject,
          html: isHtml ? message : `<p>${message.replace(/\n/g, "<br>")}</p>`,
          text: isHtml ? message.replace(/<[^>]*>/g, "") : message,
        })
      )
    ).then(results => {
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      console.log(`Sent ${successCount}/${targetEmails.length} emails to subscribers`);
    });

    res.json({ message: `Email sending started for ${targetEmails.length} subscribers` });

  } catch (err) {
    next(err);
  }
});

export default router;