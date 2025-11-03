import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAuthenticated } from "../middleware/auth.js";
import { z } from "zod";
import slugify from "slugify";

const router = Router();

// ----------------------- SCHEMAS ----------------------- //
const createTagSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  handle: z.string().optional(), // optional custom handle
});

const updateTagSchema = createTagSchema.partial();

// ----------------------- HELPERS ----------------------- //
const mapTag = (tag) => ({
  id: tag.id,
  handle: tag.handle,
  name: tag.name,
  description: tag.description,
  createdAt: tag.createdAt,
  updatedAt: tag.updatedAt,
});

// admin guard helper (we don't assume separate middleware for admin exists)
const requireAdmin = (req, res) => {
  if (!req.user || !req.user.isAdmin) {
    res.status(403).json({ error: "Not authorized" });
    return false;
  }
  return true;
};

// ----------------------- ROUTES ----------------------- //

// GET /tags - list tags (simple)
router.get("/", async (req, res, next) => {
  try {
    // optional pagination
    const { page = 1, limit = 50 } = req.query;
    const take = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [tags, total] = await Promise.all([
      prisma.tag.findMany({
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.tag.count(),
    ]);

    res.json({
      tags: tags.map(mapTag),
      pagination: {
        total,
        page: parseInt(page, 10) || 1,
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /tags/:id - get single tag (includes products count)
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const tag = await prisma.tag.findUnique({
      where: { id },
      include: {
        products: {
          include: { product: true }, // returns ProductTag join rows; product inside
          take: 100, // limit relations returned (optional)
        },
      },
    });

    if (!tag) return res.status(404).json({ error: "Tag not found" });

    const products = tag.products?.map((pt) => pt.product) || [];

    res.json({
      ...mapTag(tag),
      products,
    });
  } catch (error) {
    next(error);
  }
});

// POST /tags - create tag (admin)
router.post("/", isAuthenticated, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;

    const parsed = createTagSchema.parse(req.body);
    const { name, description = null, handle } = parsed;

    const slug = (handle && String(handle).trim()) || slugify(name, { lower: true, strict: true });

    // prevent duplicate handle or name
    const existing = await prisma.tag.findFirst({
      where: { OR: [{ handle: slug }, { name }] },
    });
    if (existing) {
      return res.status(400).json({ error: "Tag with that name or handle already exists" });
    }

    const tag = await prisma.tag.create({
      data: {
        name,
        description,
        handle: slug,
      },
    });

    res.status(201).json({ message: "Tag created", tag: mapTag(tag) });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
    next(error);
  }
});

// PUT /tags/:id - update tag (admin)
router.put("/:id", isAuthenticated, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;

    const parsed = updateTagSchema.parse(req.body);
    const { id } = req.params;

    // If user provides a handle, use it; otherwise if name changed generate handle
    let data = {};
    if (parsed.name !== undefined) data.name = parsed.name;
    if (parsed.description !== undefined) data.description = parsed.description;
    if (parsed.handle !== undefined) {
      data.handle = parsed.handle || slugify(parsed.name || "", { lower: true, strict: true });
    } else if (parsed.name) {
      // regenerate handle when name changes and no explicit handle provided
      data.handle = slugify(parsed.name, { lower: true, strict: true });
    }

    // ensure unique handle/name conflict avoided
    if (data.handle) {
      const conflict = await prisma.tag.findFirst({
        where: {
          handle: data.handle,
          NOT: { id },
        },
      });
      if (conflict) return res.status(400).json({ error: "Handle already in use" });
    }
    if (data.name) {
      const conflictName = await prisma.tag.findFirst({
        where: {
          name: data.name,
          NOT: { id },
        },
      });
      if (conflictName) return res.status(400).json({ error: "Name already in use" });
    }

    const updated = await prisma.tag.update({
      where: { id },
      data,
    });

    res.json({ message: "Tag updated", tag: mapTag(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
    // Prisma "not found"
    if (error.code === "P2025") return res.status(404).json({ error: "Tag not found" });
    next(error);
  }
});

// DELETE /tags/:id - delete tag (admin)
router.delete("/:id", isAuthenticated, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { id } = req.params;

    // remove entries from ProductTag first (optional: Prisma will handle cascade depending on schema)
    // But safe approach: delete product-tag rows, then delete tag
    await prisma.productTag.deleteMany({ where: { tagId: id } });

    await prisma.tag.delete({ where: { id } });

    res.json({ message: "Tag deleted" });
  } catch (error) {
    // Prisma "not found"
    if (error.code === "P2025") return res.status(404).json({ error: "Tag not found" });
    next(error);
  }
});

// DELETE /tags - bulk delete tags (admin)
router.delete("/", isAuthenticated, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;

    // Expect array of tag IDs in body
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No tag IDs provided" });
    }

    // Ensure all IDs are strings
    const tagIds = ids.map(String);

    // Delete related product-tag relations first
    await prisma.productTag.deleteMany({
      where: { tagId: { in: tagIds } },
    });

    // Delete the tags
    const deleted = await prisma.tag.deleteMany({
      where: { id: { in: tagIds } },
    });

    res.json({
      message: `Deleted ${deleted.count} tags successfully`,
      deletedCount: deleted.count,
    });
  } catch (error) {
    next(error);
  }
});


export default router;
