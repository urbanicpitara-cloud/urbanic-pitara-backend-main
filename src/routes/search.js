import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

/**
 * 🔍 SEARCH PRODUCTS
 */
router.get("/products", async (req, res, next) => {
  try {
    const { query, page = 1, limit = 12 } = req.query;
    const currentPage = Math.max(1, parseInt(page));
    const perPage = Math.max(1, parseInt(limit));
    const skip = (currentPage - 1) * perPage;

    if (!query?.trim()) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const searchFilter = {
      published: true,
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
        {
          tags: {
            some: {
              tag: {
                name: { contains: query, mode: "insensitive" },
              },
            },
          },
        },
      ],
    };

    const [products, totalCount] = await Promise.all([
      prisma.product.findMany({
        where: searchFilter,
        include: {
          images: true,
          tags: { include: { tag: true } },
          collection: { select: { id: true, title: true, handle: true } },
        },
        orderBy: { title: "asc" },
        skip,
        take: perPage,
      }),
      prisma.product.count({ where: searchFilter }),
    ]);

    res.json({
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        handle: p.handle,
        description: p.description,
        featuredImageUrl: p.featuredImageUrl,
        featuredImageAlt: p.featuredImageAlt,
        images: p.images,
        minPriceAmount: p.minPriceAmount,
        maxPriceAmount: p.maxPriceAmount,
        priceCurrency: p.minPriceCurrency,
        tags: p.tags.map((t) => t.tag.name),
        collection: p.collection || null,
      })),
      pagination: {
        total: totalCount,
        page: currentPage,
        limit: perPage,
        pages: Math.ceil(totalCount / perPage),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 🔎 SEARCH COLLECTIONS
 */
router.get("/collections", async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query?.trim()) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const collections = await prisma.collection.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        handle: true,
        description: true,
        imageUrl: true,
        imageAlt: true,
      },
    });

    res.json(collections);
  } catch (err) {
    next(err);
  }
});

/**
 * ⚡ AUTOCOMPLETE SEARCH
 */
router.get("/autocomplete", async (req, res, next) => {
  try {
    const { query, limit = 5 } = req.query;
    const take = Math.max(1, parseInt(limit));

    if (!query?.trim()) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const [products, collections, tags] = await Promise.all([
      prisma.product.findMany({
        where: {
          published: true,
          title: { contains: query, mode: "insensitive" },
        },
        select: {
          id: true,
          title: true,
          handle: true,
          featuredImageUrl: true,
        },
        orderBy: { title: "asc" },
        take,
      }),
      prisma.collection.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          title: true,
          handle: true,
          imageUrl: true,
          imageAlt: true,
        },
        orderBy: { title: "asc" },
        take,
      }),
      prisma.tag.findMany({
        where: {
          name: { contains: query, mode: "insensitive" },
          products: { some: { product: { published: true } } },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take,
      }),
    ]);

    res.json({ products, collections, tags });
  } catch (err) {
    next(err);
  }
});

export default router;
