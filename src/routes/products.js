import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAuthenticated, isAdmin } from "../middleware/auth.js";
import { stripHtml } from "string-strip-html";
import { cache } from "../lib/redis.js";
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
      all, // 🆕 allow all=true or limit=all
    } = req.query;

    // Create cache key from query params
    const cacheKey = `products:${JSON.stringify(req.query)}`;
    
    // Try to get from cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    const fetchAll = all === "true" || limit === "all";

    const skip = fetchAll ? 0 : (parseInt(page) - 1) * parseInt(limit);
    const take = fetchAll ? undefined : parseInt(limit);

    const where = {};

    // Collection filter
    if (collection) {
      where.collections = {
        some: { handle: collection }
      };
    }

    // Tag filter
    if (tag) {
      where.tags = { some: { tag: { handle: tag } } };
    }

    // Search filter
    if (search) {
      const searchStr = search;

      // Check if search term exactly matches a tag
      const exactTag = await prisma.tag.findUnique({
        where: { handle: searchStr },
      });

      if (exactTag) {
        where.tags = { some: { tagId: exactTag.id } };
      } else {
        where.OR = [
          { title: { contains: searchStr, mode: "insensitive" } },
          { description: { contains: searchStr, mode: "insensitive" } },
        ];
      }
    }

    // Published filter
    if (published === "true") where.published = true;
    if (published === "false") where.published = false;

    // Price filter
    const priceConditions = [];
    if (minPrice)
      priceConditions.push({ minPriceAmount: { gte: parseFloat(minPrice) } });
    if (maxPrice)
      priceConditions.push({ maxPriceAmount: { lte: parseFloat(maxPrice) } });
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
        collections: { select: { id: true, handle: true, title: true } },
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

    const response = {
      products: formatted,
      pagination: fetchAll
        ? null
        : {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(total / parseInt(limit)),
          },
    };

    // Cache for 5 minutes (300 seconds)
    await cache.set(cacheKey, response, 300);
    res.set('X-Cache', 'MISS');
    res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    
    res.json(response);
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

    // Try cache first
    const cacheKey = `product:${handle}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    const product = await prisma.product.findUnique({
      where: { handle },
      include: {
        collections: { select: { id: true, handle: true, title: true } },
        images: true,
        variants: true,
        tags: { include: { tag: true } },
        options: { include: { values: true } },
      },
    });

    if (!product) return res.status(404).json({ error: "Product not found" });

    const response = {
      ...product,
      tags: product.tags.map((t) => t.tag),
    };

    // Cache for 10 minutes
    await cache.set(cacheKey, response, 600);
    res.set('X-Cache', 'MISS');
    res.set('Cache-Control', 'public, max-age=600, s-maxage=1200');
    
    res.json(response);
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
      handle: providedHandle,
      title,
      descriptionHtml,
      vendor,
      collectionIds = [],
      tags = [],
      featuredImageUrl,
      featuredImageAlt,
      images = [],
      options = [],
      variants = [],
      published = true,
      metafields,
      metaTitle,
      metaDescription,
      metaKeywords,
    } = req.body;

    if (!title)
      return res
        .status(400)
        .json({ error: "title is required." });

    // 🪄 Generate handle (slug) if not provided
    let handle =
      providedHandle ||
      title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    // Ensure unique handle
    const existingHandle = await prisma.product.findUnique({ where: { handle } });
    if (existingHandle) {
      handle = `${handle}-${Math.random().toString(36).substring(2, 6)}`;
    }

    // 📝 Extract plain text from descriptionHtml
    const description = descriptionHtml
      ? stripHtml(descriptionHtml).result.trim()
      : "";

    // 💰 Calculate price ranges
    const prices = variants.map((v) => parseFloat(v.priceAmount || "0"));
    const minPriceAmount = prices.length ? Math.min(...prices) : 0;
    const maxPriceAmount = prices.length ? Math.max(...prices) : 0;

    const comparePrices = variants
      .map((v) => parseFloat(v.compareAmount || "0"))
      .filter((n) => !isNaN(n) && n > 0);

    const compareMinAmount = comparePrices.length
      ? Math.min(...comparePrices)
      : null;
    const compareMaxAmount = comparePrices.length
      ? Math.max(...comparePrices)
      : null;

    const currency = variants[0]?.priceCurrency || "INR";
    const compareCurrency = variants[0]?.compareCurrency || null;

    // 🧱 Transaction
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          handle,
          title,
          vendor,

          collections: {
             connect: collectionIds.map((id) => ({ id })),
          },
          description,
          descriptionHtml,
          featuredImageUrl,
          featuredImageAlt,
          published,
          publishedAt: published ? new Date() : null,
          metafields,
          metaTitle,
          metaDescription,
          metaKeywords,
          minPriceAmount,
          minPriceCurrency: currency,
          maxPriceAmount,
          maxPriceCurrency: currency,
          compareMinAmount,
          compareMinCurrency: compareCurrency,
          compareMaxAmount,
          compareMaxCurrency: compareCurrency,
        },
      });

      if (images.length)
        await tx.productImage.createMany({
          data: images.map((img) => ({
            url: img.url || img,
            altText: img.altText || null,
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
            priceCurrency: v.priceCurrency || "INR",
            compareAmount: v.compareAmount,
            compareCurrency: v.compareCurrency,
            sku: v.sku,
            barcode: v.barcode,
            inventoryQuantity: v.inventoryQuantity || 0,
            weightInGrams: v.weightInGrams,
            selectedOptions: v.selectedOptions || [],
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
        collections: true,
        images: true,
        tags: { include: { tag: true } },
        options: { include: { values: true } },
        variants: true,
      },
    });

    // Invalidate cache
    await cache.del(`product:${fullProduct.handle}`);
    await cache.delPattern('products:*');

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
 * ✏️ Bulk update products (Admin only)
 * Body: { ids: string[], updates: Record<string, any> }
 */
router.put("/bulk-update", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { ids, updates } = req.body;

    // 🧩 Validate input
    if (!ids?.length)
      return res.status(400).json({ error: "No product IDs provided." });

    if (!updates || typeof updates !== "object")
      return res.status(400).json({ error: "No update data provided." });

    // 🧩 Define relational fields AND fields that don't exist on Product model
    const relational = ["tags", "variants", "images", "options", "priceAmount", "compareAmount"];

    // 🧩 Extract non-relational update data
    const productUpdateData = Object.fromEntries(
      Object.entries(updates).filter(([key]) => !relational.includes(key))
    );

    // If priceAmount is provided, we need to update min/max fields on the Product model
    if (updates.priceAmount) {
      productUpdateData.minPriceAmount = updates.priceAmount;
      productUpdateData.maxPriceAmount = updates.priceAmount;
      productUpdateData.minPriceCurrency = "INR"; // Default currency
      productUpdateData.maxPriceCurrency = "INR";
    }

    if (updates.compareAmount) {
      productUpdateData.compareMinAmount = updates.compareAmount;
      productUpdateData.compareMaxAmount = updates.compareAmount;
      productUpdateData.compareMinCurrency = "INR";
      productUpdateData.compareMaxCurrency = "INR";
    }

    // ✅ Update scalar fields for all selected products
    if (Object.keys(productUpdateData).length > 0) {
      await prisma.product.updateMany({
        where: { id: { in: ids } },
        data: productUpdateData,
      });
    }

    // ✅ Handle tags (merge new tags, don’t remove existing)
    if (updates.tags && Array.isArray(updates.tags) && updates.tags.length > 0) {
      try {
        // 1️⃣ Ensure all tags exist or create missing ones
        const tags = [];
        for (const tagHandle of updates.tags) {
          let tag = await prisma.tag.findUnique({ where: { handle: tagHandle } });
          if (!tag) {
            tag = await prisma.tag.create({
              data: {
                handle: tagHandle,
                name: tagHandle
                  .replace(/-/g, " ")
                  .replace(/\b\w/g, (l) => l.toUpperCase()),
              },
            });
          }
          tags.push(tag);
        }

        // 2️⃣ Attach tags to each selected product in BULK
        // Use createMany with skipDuplicates for massive performance boost (1 query vs N*M)
        if (ids.length > 0 && tags.length > 0) {
          const productTagsToCreate = [];
          
          for (const id of ids) {
            for (const tag of tags) {
              productTagsToCreate.push({
                productId: id,
                tagId: tag.id
              });
            }
          }

          if (productTagsToCreate.length > 0) {
            await prisma.productTag.createMany({
              data: productTagsToCreate,
              skipDuplicates: true, // Only creates if relation doesn't exist
            });
          }
        }
      } catch (err) {
        console.error("Warning: Tag update failed partially", err);
        // Don't fail the whole request if tags fail
      }
    }

    // ✅ Handle bulk price update for product variants
    if (updates.priceAmount || updates.compareAmount) {
      await prisma.productVariant.updateMany({
        where: { productId: { in: ids } },
        data: {
          ...(updates.priceAmount && { priceAmount: updates.priceAmount }),
          ...(updates.compareAmount && { compareAmount: updates.compareAmount }),
        },
      });
    }

    // ✅ Send response
    res.json({
      success: true,
      message: `✅ Updated ${ids.length} product${ids.length > 1 ? "s" : ""} successfully.`,
    });
  } catch (err) {
    console.error("❌ Bulk update failed:", err);
    next(err);
  }
});




/**
 * ✏️ Update product (Admin only)
 */
router.put("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      handle: providedHandle,
      descriptionHtml,
      vendor,
      collectionIds,
      tags = [],
      featuredImageUrl,
      featuredImageAlt,
      images = [],
      options = [],
      variants = [],
      published,
      metafields,
      metaTitle,
      metaDescription,
      metaKeywords,
    } = req.body;

    const existing = await prisma.product.findUnique({
      where: { id },
      include: { images: true, options: true, variants: true, tags: true },
    });
    if (!existing)
      return res.status(404).json({ error: "Product not found" });

    // 🪄 Generate or validate handle (slug)
    let handle =
      providedHandle ||
      title?.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      existing.handle;

    const existingHandle = await prisma.product.findUnique({
      where: { handle },
    });
    if (existingHandle && existingHandle.id !== id) {
      handle = `${handle}-${Math.random().toString(36).substring(2, 6)}`;
    }

    // 📝 Extract plain text from descriptionHtml
    const description = descriptionHtml
      ? stripHtml(descriptionHtml).result.trim()
      : existing.description;

    // 💰 Recalculate price ranges
    const prices = variants.map((v) => parseFloat(v.priceAmount || "0"));
    const minPriceAmount = prices.length ? Math.min(...prices) : existing.minPriceAmount;
    const maxPriceAmount = prices.length ? Math.max(...prices) : existing.maxPriceAmount;

    const comparePrices = variants
      .map((v) => parseFloat(v.compareAmount || "0"))
      .filter((n) => !isNaN(n) && n > 0);

    const compareMinAmount = comparePrices.length
      ? Math.min(...comparePrices)
      : existing.compareMinAmount;
    const compareMaxAmount = comparePrices.length
      ? Math.max(...comparePrices)
      : existing.compareMaxAmount;

    const currency = variants[0]?.priceCurrency || existing.minPriceCurrency || "INR";
    const compareCurrency = variants[0]?.compareCurrency || existing.compareMinCurrency;

    // 🧱 Transaction for atomic update
    const updated = await prisma.$transaction(async (tx) => {
      // 1️⃣ Update base product
      const product = await tx.product.update({
        where: { id },
        data: {
          title: title ?? existing.title,
          handle,
          vendor: vendor ?? existing.vendor,
          collections: collectionIds
            ? { set: collectionIds.map((id) => ({ id })) }
            : undefined,
          descriptionHtml: descriptionHtml ?? existing.descriptionHtml,
          description,
          featuredImageUrl: featuredImageUrl ?? existing.featuredImageUrl,
          featuredImageAlt: featuredImageAlt ?? existing.featuredImageAlt,
          published: published ?? existing.published,
          metafields: metafields ?? existing.metafields,
          metaTitle: metaTitle ?? existing.metaTitle,
          metaDescription: metaDescription ?? existing.metaDescription,
          metaKeywords: metaKeywords ?? existing.metaKeywords,
          minPriceAmount,
          minPriceCurrency: currency,
          maxPriceAmount,
          maxPriceCurrency: currency,
          compareMinAmount,
          compareMinCurrency: compareCurrency,
          compareMaxAmount,
          compareMaxCurrency: compareCurrency,
          updatedAt: new Date(),
        },
      });

      // 2️⃣ Images — replace all
      if (Array.isArray(images)) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (images.length) {
          await tx.productImage.createMany({
            data: images.map((img) => ({
              url: img.url || img,
              altText: img.altText || null,
              productId: id,
            })),
          });
        }
      }

      // 3️⃣ Options and values — replace all
      if (Array.isArray(options)) {
        await tx.productOptionValue.deleteMany({
          where: { option: { productId: id } },
        });
        await tx.productOption.deleteMany({ where: { productId: id } });

        for (const option of options) {
          const opt = await tx.productOption.create({
            data: { name: option.name, productId: id },
          });
          if (option.values?.length) {
            await tx.productOptionValue.createMany({
              data: option.values.map((v) => ({
                name: v.name,
                color: v.color,
                optionId: opt.id,
              })),
            });
          }
        }
      }

      // 4️⃣ Variants — replace all
      if (Array.isArray(variants)) {
        await tx.productVariant.deleteMany({ where: { productId: id } });
        if (variants.length) {
          await tx.productVariant.createMany({
            data: variants.map((v) => ({
              productId: id,
              availableForSale: v.availableForSale ?? true,
              priceAmount: v.priceAmount,
              priceCurrency: v.priceCurrency || "INR",
              compareAmount: v.compareAmount,
              compareCurrency: v.compareCurrency,
              sku: v.sku,
              barcode: v.barcode,
              inventoryQuantity: v.inventoryQuantity || 0,
              weightInGrams: v.weightInGrams,
              selectedOptions: v.selectedOptions || [],
            })),
          });
        }
      }

      // 5️⃣ Tags — recreate if needed
      if (Array.isArray(tags)) {
        await tx.productTag.deleteMany({ where: { productId: id } });
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
            data: { productId: id, tagId: tag.id },
          });
        }
      }

      return product;
    });

    // 6️⃣ Fetch full updated product
    const fullProduct = await prisma.product.findUnique({
      where: { id: updated.id },
      include: {
        collections: true,
        images: true,
        tags: { include: { tag: true } },
        options: { include: { values: true } },
        variants: true,
      },
    });

    // Invalidate cache
    await cache.del(`product:${updated.handle}`);
    await cache.delPattern('products:*'); // Clear all product list caches

    res.json({
      ...fullProduct,
      tags: fullProduct.tags.map((t) => t.tag),
    });
  } catch (err) {
    console.error("Product update failed:", err);
    next(err);
  }
});



/**
 * 🗑️ Bulk Delete Products (Admin only)
 * Body: { ids: string[] }
 */
router.delete("/bulk-delete", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body;

    if (!ids?.length) {
      return res.status(400).json({ error: "No product IDs provided." });
    }

    // ✅ Check all exist
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    if (products.length === 0) {
      return res.status(404).json({ error: "No valid products found." });
    }

    await prisma.$transaction(async (tx) => {
      // Delete child records first for referential integrity
      await tx.productImage.deleteMany({ where: { productId: { in: ids } } });

      const optionIds = (
        await tx.productOption.findMany({ where: { productId: { in: ids } } })
      ).map((o) => o.id);

      if (optionIds.length)
        await tx.productOptionValue.deleteMany({
          where: { optionId: { in: optionIds } },
        });

      await tx.productOption.deleteMany({ where: { productId: { in: ids } } });
      await tx.productVariant.deleteMany({ where: { productId: { in: ids } } });
      await tx.productTag.deleteMany({ where: { productId: { in: ids } } });
      await tx.cartLine.deleteMany({ where: { productId: { in: ids } } });
      await tx.orderItem.deleteMany({ where: { productId: { in: ids } } });
      await tx.product.deleteMany({ where: { id: { in: ids } } });
    });

    res.json({
      success: true,
      message: `🗑️ Deleted ${ids.length} product${ids.length > 1 ? "s" : ""} successfully.`,
    });
  } catch (err) {
    console.error("❌ Bulk delete failed:", err);
    next(err);
  }
});




/**
 * ❌ Delete product (Admin only)
 */
router.delete("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
        
    const { id } = req.params;
    console.log(id)
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

    // Invalidate cache
    await cache.del(`product:${product.handle}`);
    await cache.delPattern('products:*');

    res.status(200).json({success:true,message:"Product Deleted Successfully"});
  } catch (err) {
    res.json({success:false,message:"Some Error Occurred",err})
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
          collections: {
            some: {
              id: { in: product.collections?.map(c => c.id) || [] }
            }
          },
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
