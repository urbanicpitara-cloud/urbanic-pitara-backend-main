import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAuthenticated, isAdmin } from "../middleware/auth.js";

const router = Router();

/**
 * 🛍️ Get all products (with pagination, filtering, sorting)
 */
router.get("/", async (req, res, next) => {
  try {
    const {
      page = "1",
      limit = "10",
      sort = "createdAt",
      order = "desc",
      collection,
      tag,
      search,
      minPrice,
      maxPrice,
      published,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {};

    // Collection filter
    if (collection) {
      const coll = await prisma.collection.findUnique({
        where: { handle: collection },
      });
      if (coll) where.collectionId = coll.id;
    }

    // Tag filter
    if (tag) {
      where.tags = { some: { tag: { handle: tag } } };
    }

    // Search filter
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    // Published filter
    if (published === "true") where.published = true;
    if (published === "false") where.published = false;

    // Price filter
    const priceConditions = [];
    if (minPrice) priceConditions.push({ minPriceAmount: { gte: parseFloat(minPrice) } });
    if (maxPrice) priceConditions.push({ maxPriceAmount: { lte: parseFloat(maxPrice) } });
    if (priceConditions.length > 0) {
      where.AND = where.AND ? [...where.AND, ...priceConditions] : priceConditions;
    }

    // Fetch total count
    const total = await prisma.product.count({ where });

    // Fetch products
    const products = await prisma.product.findMany({
      where,
      skip,
      take,
      orderBy: { [sort]: order.toLowerCase() },
      include: {
        collection: { select: { id: true, handle: true, title: true } },
        images: true,
        variants: true,
        tags: { include: { tag: true } },
        options: { include: { values: true } },
      },
    });

    // Format tags
    const formatted = products.map((p) => ({
      ...p,
      tags: p.tags ? p.tags.map((t) => t.tag) : [],
    }));

    res.json({
      products: formatted,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});




/**
 * 🧾 Get single product by handle
 */
router.get("/:handle", async (req, res, next) => {
  try {
    const { handle } = req.params;

    const product = await prisma.product.findUnique({
      where: { handle },
      include: {
        collection: { select: { id: true, handle: true, title: true } },
        images: true,
        variants: true,
        tags: { include: { tag: true } },
        options: { include: { values: true } },
      },
    });

    if (!product) return res.status(404).json({ error: "Product not found" });

    res.json({
      ...product,
      tags: product.tags.map((t) => t.tag),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * ➕ Create product (Admin only)
 */
router.post("/", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const {
      handle,
      title,
      description,
      descriptionHtml,
      vendor,
      collectionId,
      tags = [],
      featuredImageUrl,
      featuredImageAlt,
      images = [],
      options = [],
      variants = [],
      published = true,
      metafields,
    } = req.body;

    if (!handle || !title || !collectionId)
      return res
        .status(400)
        .json({ error: "handle, title, and collectionId are required." });

    const existing = await prisma.product.findUnique({ where: { handle } });
    if (existing)
      return res.status(400).json({ error: "Handle already exists." });

    // calculate price range
    const prices = variants.map((v) => parseFloat(v.priceAmount || "0"));
    const minPriceAmount = prices.length ? Math.min(...prices).toString() : "0";
    const maxPriceAmount = prices.length ? Math.max(...prices).toString() : "0";
    const currency = variants[0]?.priceCurrency || "INR";

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          handle,
          title,
          description,
          descriptionHtml,
          vendor,
          collectionId,
          featuredImageUrl,
          featuredImageAlt,
          published,
          publishedAt: published ? new Date() : null,
          metafields,
          minPriceAmount,
          minPriceCurrency: currency,
          maxPriceAmount,
          maxPriceCurrency: currency,
        },
      });

      if (images.length)
        await tx.productImage.createMany({
          data: images.map((img) => ({
            url: img.url,
            altText: img.altText,
            productId: created.id,
          })),
        });

      for (const option of options) {
        const opt = await tx.productOption.create({
          data: { name: option.name, productId: created.id },
        });

        if (option.values?.length)
          await tx.productOptionValue.createMany({
            data: option.values.map((v) => ({
              name: v.name,
              color: v.color,
              optionId: opt.id,
            })),
          });
      }

      if (variants.length)
        await tx.productVariant.createMany({
          data: variants.map((v) => ({
            productId: created.id,
            availableForSale: v.availableForSale ?? true,
            priceAmount: v.priceAmount,
            priceCurrency: v.priceCurrency,
            compareAmount: v.compareAmount,
            compareCurrency: v.compareCurrency,
            sku: v.sku,
            barcode: v.barcode,
            inventoryQuantity: v.inventoryQuantity || 0,
            weightInGrams: v.weightInGrams,
            selectedOptions: v.selectedOptions,
          })),
        });

      for (const tagHandle of tags) {
        let tag = await tx.tag.findUnique({ where: { handle: tagHandle } });
        if (!tag) {
          tag = await tx.tag.create({
            data: {
              handle: tagHandle,
              name: tagHandle
                .replace(/-/g, " ")
                .replace(/\b\w/g, (l) => l.toUpperCase()),
            },
          });
        }
        await tx.productTag.create({
          data: { productId: created.id, tagId: tag.id },
        });
      }

      return created;
    });

    const fullProduct = await prisma.product.findUnique({
      where: { id: product.id },
      include: {
        collection: true,
        images: true,
        tags: { include: { tag: true } },
        options: { include: { values: true } },
        variants: true,
      },
    });

    res.status(201).json({
      ...fullProduct,
      tags: fullProduct.tags.map((t) => t.tag),
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

/**
 * ✏️ Update product (Admin only)
 */
router.put("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ error: "Product not found" });

    const product = await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...data,
          publishedAt:
            data.published !== undefined
              ? data.published
                ? new Date()
                : null
              : undefined,
        },
      });

      // Clean + recreate relational data if provided
      if (data.images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (data.images.length)
          await tx.productImage.createMany({
            data: data.images.map((i) => ({
              url: i.url,
              altText: i.altText,
              productId: id,
            })),
          });
      }

      if (data.options) {
        const optionIds = (
          await tx.productOption.findMany({ where: { productId: id } })
        ).map((o) => o.id);

        await tx.productOptionValue.deleteMany({
          where: { optionId: { in: optionIds } },
        });
        await tx.productOption.deleteMany({ where: { productId: id } });

        for (const option of data.options) {
          const opt = await tx.productOption.create({
            data: { name: option.name, productId: id },
          });
          if (option.values?.length)
            await tx.productOptionValue.createMany({
              data: option.values.map((v) => ({
                name: v.name,
                color: v.color,
                optionId: opt.id,
              })),
            });
        }
      }

      if (data.variants) {
        await tx.productVariant.deleteMany({ where: { productId: id } });
        if (data.variants.length)
          await tx.productVariant.createMany({
            data: data.variants.map((v) => ({
              productId: id,
              availableForSale: v.availableForSale ?? true,
              priceAmount: v.priceAmount,
              priceCurrency: v.priceCurrency,
              compareAmount: v.compareAmount,
              compareCurrency: v.compareCurrency,
              sku: v.sku,
              barcode: v.barcode,
              inventoryQuantity: v.inventoryQuantity || 0,
              weightInGrams: v.weightInGrams,
              selectedOptions: v.selectedOptions,
            })),
          });
      }

      if (data.tags) {
        await tx.productTag.deleteMany({ where: { productId: id } });
        for (const tagHandle of data.tags) {
          let tag = await tx.tag.findUnique({ where: { handle: tagHandle } });
          if (!tag) {
            tag = await tx.tag.create({
              data: {
                handle: tagHandle,
                name: tagHandle
                  .replace(/-/g, " ")
                  .replace(/\b\w/g, (l) => l.toUpperCase()),
              },
            });
          }
          await tx.productTag.create({
            data: { productId: id, tagId: tag.id },
          });
        }
      }
    });

    const updated = await prisma.product.findUnique({
      where: { id },
      include: {
        collection: true,
        images: true,
        tags: { include: { tag: true } },
        options: { include: { values: true } },
        variants: true,
      },
    });

    res.json({
      ...updated,
      tags: updated.tags.map((t) => t.tag),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * ❌ Delete product (Admin only)
 */
router.delete("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product)
      return res.status(404).json({ error: "Product not found" });

    await prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({ where: { productId: id } });
      const optionIds = (
        await tx.productOption.findMany({ where: { productId: id } })
      ).map((o) => o.id);
      await tx.productOptionValue.deleteMany({
        where: { optionId: { in: optionIds } },
      });
      await tx.productOption.deleteMany({ where: { productId: id } });
      await tx.productVariant.deleteMany({ where: { productId: id } });
      await tx.productTag.deleteMany({ where: { productId: id } });
      await tx.cartLine.deleteMany({ where: { productId: id } });
      await tx.orderItem.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * 🤝 Related products (based on tags or collection)
 */
router.get("/:handle/related", async (req, res, next) => {
  try {
    const { handle } = req.params;
    const { limit = 4 } = req.query;

    const product = await prisma.product.findUnique({
      where: { handle },
      include: { tags: { include: { tag: true } } },
    });

    if (!product) return res.status(404).json({ error: "Product not found" });

    const tagIds = product.tags.map((t) => t.tagId);

    let related = await prisma.product.findMany({
      where: {
        id: { not: product.id },
        published: true,
        tags: { some: { tagId: { in: tagIds } } },
      },
      take: parseInt(limit),
      include: {
        images: true,
        variants: { take: 1 },
        tags: { include: { tag: true } },
      },
    });

    if (related.length < parseInt(limit)) {
      const more = await prisma.product.findMany({
        where: {
          id: { notIn: [product.id, ...related.map((r) => r.id)] },
          collectionId: product.collectionId,
          published: true,
        },
        take: parseInt(limit) - related.length,
        include: {
          images: true,
          variants: { take: 1 },
          tags: { include: { tag: true } },
        },
      });
      related = related.concat(more);
    }

    res.json(
      related.map((r) => ({
        ...r,
        tags: r.tags.map((t) => t.tag),
      }))
    );
  } catch (err) {
    next(err);
  }
});

export default router;
