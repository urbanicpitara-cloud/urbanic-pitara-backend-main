import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAuthenticated, isAdmin } from "../middleware/auth.js";

const router = Router();

// ----------------------- PUBLIC ROUTES ----------------------- //

// Get all menus
router.get("/", async (req, res, next) => {
  try {
    const menus = await prisma.menu.findMany({
      include: {
        items: {
          orderBy: { position: "asc" },
        },
      },
      orderBy: { title: "asc" },
    });
    res.json(menus);
  } catch (error) {
    next(error);
  }
});

// Get menu by handle
router.get("/:handle", async (req, res, next) => {
  try {
    const { handle } = req.params;
    const menu = await prisma.menu.findFirst({
      where: { handle },
      include: { items: { orderBy: { position: "asc" } } },
    });
    if (!menu) return res.status(404).json({ error: "Menu not found" });
    res.json(menu);
  } catch (error) {
    next(error);
  }
});

// ----------------------- ADMIN ROUTES ----------------------- //

// Get all menus
router.get("/admin/all", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const menus = await prisma.menu.findMany({
      include: { items: { orderBy: { position: "asc" } } },
      orderBy: { title: "asc" },
    });
    res.json(menus);
  } catch (error) {
    next(error);
  }
});

// Create a new menu
router.post("/", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { title, handle } = req.body;
    if (!title || !handle) return res.status(400).json({ error: "Title and handle are required" });

    const existingMenu = await prisma.menu.findUnique({ where: { handle } });
    if (existingMenu) return res.status(400).json({ error: "Menu with this handle already exists" });

    const menu = await prisma.menu.create({ data: { title, handle } });
    res.status(201).json(menu);
  } catch (error) {
    next(error);
  }
});

// Update a menu
router.put("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, handle } = req.body;

    const existingMenu = await prisma.menu.findUnique({ where: { id } });
    if (!existingMenu) return res.status(404).json({ error: "Menu not found" });

    if (handle && handle !== existingMenu.handle) {
      const handleExists = await prisma.menu.findFirst({ where: { handle, id: { not: id } } });
      if (handleExists) return res.status(400).json({ error: "Handle already exists" });
    }

    const updatedMenu = await prisma.menu.update({
      where: { id },
      data: {
        title: title ?? undefined,
        handle: handle ?? undefined,
      },
    });

    res.json(updatedMenu);
  } catch (error) {
    next(error);
  }
});

// Delete a menu
router.delete("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const existingMenu = await prisma.menu.findUnique({ where: { id } });
    if (!existingMenu) return res.status(404).json({ error: "Menu not found" });

    await prisma.menuItem.deleteMany({ where: { menuId: id } });
    await prisma.menu.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Add a menu item
router.post("/:id/items", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, url, position } = req.body;
    if (!title || !url) return res.status(400).json({ error: "Title and URL are required" });

    const existingMenu = await prisma.menu.findUnique({ where: { id } });
    if (!existingMenu) return res.status(404).json({ error: "Menu not found" });

    let itemPosition = position;
    if (itemPosition === undefined) {
      const highest = await prisma.menuItem.findFirst({
        where: { menuId: id },
        orderBy: { position: "desc" },
      });
      itemPosition = highest ? highest.position + 1 : 0;
    }

    const menuItem = await prisma.menuItem.create({
      data: { title, url, position: itemPosition, menuId: id },
    });

    res.status(201).json(menuItem);
  } catch (error) {
    next(error);
  }
});

// Update a menu item
router.put("/items/:itemId", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const { title, url, position } = req.body;

    const existingItem = await prisma.menuItem.findUnique({ where: { id: itemId } });
    if (!existingItem) return res.status(404).json({ error: "Menu item not found" });

    const updatedItem = await prisma.menuItem.update({
      where: { id: itemId },
      data: {
        title: title ?? undefined,
        url: url ?? undefined,
        position: position ?? undefined,
      },
    });

    res.json(updatedItem);
  } catch (error) {
    next(error);
  }
});

// Delete a menu item
router.delete("/items/:itemId", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { itemId } = req.params;

    const existingItem = await prisma.menuItem.findUnique({ where: { id: itemId } });
    if (!existingItem) return res.status(404).json({ error: "Menu item not found" });

    await prisma.menuItem.delete({ where: { id: itemId } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Reorder menu items
router.post("/:id/reorder", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: "Items must be an array" });

    const existingMenu = await prisma.menu.findUnique({ where: { id } });
    if (!existingMenu) return res.status(404).json({ error: "Menu not found" });

    await prisma.$transaction(
      items.map((item, index) => prisma.menuItem.update({ where: { id: item.id }, data: { position: index } }))
    );

    const updatedMenu = await prisma.menu.findUnique({
      where: { id },
      include: { items: { orderBy: { position: "asc" } } },
    });

    res.json(updatedMenu);
  } catch (error) {
    next(error);
  }
});

export default router;
