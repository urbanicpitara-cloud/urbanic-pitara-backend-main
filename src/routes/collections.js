import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAuthenticated, isAdmin } from "../middleware/auth.js";

const router = Router();

// Utility: generate collection handle
const makeHandle = (title) =>
  title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");

/**
 * 🧾 Get all collections
 */
router.get("/", async (req, res, next) => {
  try {
    const collections = await prisma.collection.findMany({
      orderBy: { title: "asc" },
      include: {
        _count: { select: { products: true } },
      },
    });

    res.json(
      collections.map((c) => ({
        id: c.id,
        title: c.title,
        handle: c.handle,
        description: c.description,
        imageUrl: c.imageUrl,
        imageAlt: c.imageAlt,
        productCount: c._count.products,
      }))
    );
  } catch (err) {
    next(err);
  }
});

/**
 * 🧩 Get a single collection by handle (with paginated products)
 */
router.get("/:handle", async (req, res, next) => {
  try {
    const { handle } = req.params;
    const page = req.query.page ? Math.max(parseInt(req.query.page ), 1) : null;
    const limit = req.query.limit ? Math.max(parseInt(req.query.limit), 1) : null;
    const skip = page && limit ? (page - 1) * limit : undefined;

    // Fetch collection
    const collection = await prisma.collection.findUnique({
      where: { handle },
      include: {
        products: {
          include: {
            images: true,
            tags: { include: { tag: true } },
            variants: true,
            options: { include: { values: true } },
          },
          skip,
          take: limit || undefined, // fetch all if limit not provided
          orderBy: { title: "asc" },
        },
      },
    });

    if (!collection) return res.status(404).json({ error: "Collection not found" });

    // Count total products
    const totalProducts = await prisma.product.count({
      where: { collectionId: collection.id },
    });

    res.json({
      id: collection.id,
      title: collection.title,
      handle: collection.handle,
      description: collection.description,
      imageUrl: collection.imageUrl,
      imageAlt: collection.imageAlt,
      products: collection.products.map((p) => ({
        id: p.id,
        title: p.title,
        handle: p.handle,
        description: p.description,
        featuredImageUrl: p.featuredImageUrl,
        featuredImageAlt: p.featuredImageAlt,
        images: p.images,
        minPriceAmount: p.minPriceAmount,
        maxPriceAmount: p.maxPriceAmount,
        compareMaxAmount: p.compareMaxAmount,
        compareMinAmount: p.compareMinAmount,
        priceCurrency: p.minPriceCurrency,
        variants: p.variants,
        tags: p.tags.map((t) => t.tag.name),
      })),
      pagination: page && limit
        ? {
            page,
            limit,
            total: totalProducts,
            totalPages: Math.max(Math.ceil(totalProducts / limit), 1),
          }
        : undefined, // no pagination info if fetching all
    });
  } catch (err) {
    next(err);
  }
});


/**
 * 👑 Get all collections (Admin) with pagination
 */
router.get("/admin/all", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page ) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit ) || 10, 1);
    const skip = (page - 1) * limit;

    const sortField = (req.query.sortField ) || "title";
    const sortOrder = (req.query.sortOrder ) === "desc" ? "desc" : "asc";

    const search = (req.query.search) || "";

    // Count total collections
    const totalCollections = await prisma.collection.count({
      where: { title: { contains: search, mode: "insensitive" } },
    });

    // Fetch paginated collections
    const collections = await prisma.collection.findMany({
      where: { title: { contains: search, mode: "insensitive" } },
      include: { _count: { select: { products: true } } },
      orderBy: { [sortField]: sortOrder },
      skip,
      take: limit,
    });

    res.json({
      collections: collections.map((c) => ({
        id: c.id,
        title: c.title,
        handle: c.handle,
        description: c.description,
        imageUrl: c.imageUrl,
        imageAlt: c.imageAlt,
        productCount: c._count.products,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total: totalCollections,
        totalPages: Math.max(Math.ceil(totalCollections / limit), 1),
      },
    });
  } catch (err) {
    next(err);
  }
});


/**
 * ➕ Create collection (Admin)
 */
router.post("/", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { title, handle, description, imageUrl, imageAlt } = req.body;

    if (!title)
      return res.status(400).json({ error: "Title is required." });

    const collectionHandle = handle || makeHandle(title);

    const exists = await prisma.collection.findUnique({
      where: { handle: collectionHandle },
    });
    if (exists)
      return res
        .status(400)
        .json({ error: "Collection with this handle already exists." });

    const collection = await prisma.collection.create({
      data: { title, handle: collectionHandle, description, imageUrl, imageAlt },
    });

    res.status(201).json(collection);
  } catch (err) {
    next(err);
  }
});

/**
 * ✏️ Update collection (Admin)
 */
router.put("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, handle, description, imageUrl, imageAlt } = req.body;

    const collection = await prisma.collection.findUnique({ where: { id } });
    if (!collection)
      return res.status(404).json({ error: "Collection not found" });

    let newHandle = handle;
    if (!newHandle && title && title !== collection.title) {
      newHandle = makeHandle(title);
    }

    if (newHandle && newHandle !== collection.handle) {
      const handleExists = await prisma.collection.findUnique({
        where: { handle: newHandle },
      });
      if (handleExists)
        return res
          .status(400)
          .json({ error: "Collection with this handle already exists" });
    }

    const updated = await prisma.collection.update({
      where: { id },
      data: {
        title: title ?? undefined,
        handle: newHandle ?? undefined,
        description: description ?? undefined,
        imageUrl: imageUrl ?? undefined,
        imageAlt: imageAlt ?? undefined,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * ❌ Delete collection (Admin)
 */
router.delete("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.collection.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ error: "Collection not found" });

    await prisma.$transaction(async (tx) => {
      // Optional: Set collectionId to null for its products
      await tx.product.updateMany({
        where: { collectionId: id },
        data: { collectionId: null },
      });

      // Delete collection
      await tx.collection.delete({ where: { id } });
    });

    res.json({ message: "Collection deleted successfully" });
  } catch (err) {
    next(err);
  }
});

/**
 * 🧱 Add products to collection (Admin)
 */
router.post("/:id/products", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || !productIds.length)
      return res.status(400).json({ error: "Product IDs are required." });

    const exists = await prisma.collection.findUnique({ where: { id } });
    if (!exists)
      return res.status(404).json({ error: "Collection not found" });

    await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: { collectionId: id },
    });

    res.json({ message: "Products added to collection successfully" });
  } catch (err) {
    next(err);
  }
});


/**
 * 🧩 Add products to collection by rule (Admin)
 */
router.post("/:id/products/by-rule", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { titleContains, priceMin, priceMax, tags } = req.body;

    const collection = await prisma.collection.findUnique({ where: { id } });
    if (!collection) return res.status(404).json({ error: "Collection not found" });

    // Build dynamic query
    const where = {};
    const AND = [];

    if (titleContains) AND.push({ title: { contains: titleContains, mode: "insensitive" } });
    if (priceMin !== undefined) AND.push({ minPriceAmount: { gte: priceMin } });
    if (priceMax !== undefined) AND.push({ maxPriceAmount: { lte: priceMax } });
    if (Array.isArray(tags) && tags.length > 0) {
      AND.push({ tags: { some: { tag: { name: { in: tags } } } } });
    }

    if (AND.length) where.AND = AND;

    const products = await prisma.product.findMany({ where });

    if (!products.length)
      return res.status(200).json({ message: "No products matched the criteria." });

    await prisma.product.updateMany({
      where: { id: { in: products.map(p => p.id) } },
      data: { collectionId: id },
    });

    res.json({ message: "Products added by rule successfully", count: products.length });
  } catch (err) {
    next(err);
  }
});


/**
 * 🧹 Remove products from collection (Admin)
 */
router.delete("/:id/products", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || !productIds.length)
      return res.status(400).json({ error: "Product IDs are required." });

    const exists = await prisma.collection.findUnique({ where: { id } });
    if (!exists)
      return res.status(404).json({ error: "Collection not found" });

    await prisma.product.updateMany({
      where: { id: { in: productIds }, collectionId: id },
      data: { collectionId: null },
    });

    res.json({ message: "Products removed from collection successfully" });
  } catch (err) {
    next(err);
  }
});

export default router;
