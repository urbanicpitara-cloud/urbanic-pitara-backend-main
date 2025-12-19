import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAuthenticated, isAdmin } from "../middleware/auth.js";

const router = Router();

// GET /variant-groups/search?q=...
router.get("/search", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { q } = req.query;
    const where = {};
    
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    const groups = await prisma.variantGroup.findMany({
      where,
      include: {
        products: {
            select: { id: true, title: true, handle: true, metafields: true, images: { take: 1, select: { url: true } } }
        }
      },
      take: 20,
    });
    res.json(groups);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to search groups" });
  }
});


// GET /variant-groups/:id
router.get("/:id", async (req, res) => {
  try {
    const group = await prisma.variantGroup.findUnique({
      where: { id: req.params.id },
      include: {
        products: {
          select: {
            id: true,
            title: true,
            handle: true,
            metafields: true,
            images: { take: 1, select: { url: true } } 
          },
        },
      },
    });
    if (!group) return res.status(404).json({ error: "Group not found" });
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch group" });
  }
});

// POST /variant-groups
router.post("/", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { name, description, productIds } = req.body;
    const group = await prisma.variantGroup.create({
      data: {
        name,
        description,
        products: productIds?.length
          ? { connect: productIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { products: true },
    });
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: "Failed to create group" });
  }
});

// PUT /variant-groups/:id
router.put("/:id", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { name, description, productIds } = req.body;
    
    // If productIds is provided, we replace the existing connections
    const data = {
        name,
        description
    };

    if (productIds) {
        data.products = { set: productIds.map(id => ({ id })) };
    }

    const group = await prisma.variantGroup.update({
      where: { id: req.params.id },
      data,
      include: { products: true },
    });
    res.json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update group" });
  }
});

// DELETE /variant-groups/:id
router.delete("/:id", isAuthenticated, isAdmin, async (req, res) => {
  try {
    await prisma.variantGroup.delete({
      where: { id: req.params.id },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete group" });
  }
});

export default router;
