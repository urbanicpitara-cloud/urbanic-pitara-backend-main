import { Router } from "express";
import prisma from "../lib/prisma.js";
import bcrypt from "bcrypt";
import { isAuthenticated, isAdmin } from "../middleware/auth.js";
import { sendAdminGeneratedPasswordEmail } from "../lib/email.js";

const router = Router();

/**
 * 🗂 Get All Users with optional pagination, search, or fetch all
 * Query params:
 * - page: number (default 1)
 * - limit: number (default 10)
 * - search: string (optional, search by name or email)
 * - all: boolean (if true, ignore pagination and return all users)
 */
router.get("/", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { page = "1", limit = "10", search = "", all } = req.query;

    const where = search
      ? {
          OR: [
            { firstName: { contains: search , mode: "insensitive" } },
            { lastName: { contains: search , mode: "insensitive" } },
            { email: { contains: search , mode: "insensitive" } },
          ],
        }
      : {};

    let users;
    let total;

    if (all === "true") {
      // Return all users without pagination
      users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          isAdmin: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
      total = users.length;
    } else {
      // Paginated result
      const pageNum = Math.max(Number(page), 1);
      const limitNum = Math.max(Number(limit), 1);

      total = await prisma.user.count({ where });

      users = await prisma.user.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          isAdmin: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
    }

    res.json({
      success: true,
      users,
      pagination: {
        total,
        page: all === "true" ? 1 : Number(page),
        limit: all === "true" ? total : Number(limit),
        pages: all === "true" ? 1 : Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 👤 Get Single User by ID
 */
router.get("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

/**
 * ✏️ Update User (Admin Only)
 */
router.put("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, email, isAdmin } = req.body;

    const updated = await prisma.user.update({
      where: { id },
      data: {
        firstName,
        lastName,
        phone,
        email: email?.trim().toLowerCase(),
        isAdmin,
      },
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * 🔒 Reset User Password (Admin Only)
 */
router.put("/:id/reset-password", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const newPassword = Math.random().toString(36).slice(-8); // Random 8-char password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    const user = await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    // Send new password via email
    await sendAdminGeneratedPasswordEmail(user, newPassword);

    res.json({ success: true, message: "Password reset successfully", newPassword });
  } catch (err) {
    next(err);
  }
});
/**
 * 🗑 Delete User (Admin Only)
 */
router.delete("/:id", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Delete OrderItems
    await prisma.orderItem.deleteMany({
      where: { order: { userId: id } },
    });

    // Delete Payments
    await prisma.payment.deleteMany({
      where: { order: { userId: id } },
    });

    // Delete Orders
    await prisma.order.deleteMany({
      where: { userId: id },
    });

    // Delete CartLines
    await prisma.cartLine.deleteMany({
      where: { cart: { userId: id } },
    });

    // Delete Carts
    await prisma.cart.deleteMany({
      where: { userId: id },
    });

    // Delete WishlistItems
    await prisma.wishlistItem.deleteMany({
      where: { wishlist: { userId: id } },
    });

    // Delete Wishlists
    await prisma.wishlist.deleteMany({
      where: { userId: id },
    });

    // Delete Reviews
    await prisma.review.deleteMany({
      where: { userId: id },
    });

    // Delete Addresses
    await prisma.address.deleteMany({
      where: { userId: id },
    });

    // Finally, delete the User
    await prisma.user.delete({
      where: { id },
    });

    res.json({ success: true, message: "User and all related data deleted successfully" });
  } catch (err) {
    next(err);
  }
});


router.delete("/", isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body; // expects { ids: ["id1", "id2", ...] }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "No user IDs provided" });
    }

    // Delete child records for all users
    await prisma.orderItem.deleteMany({
      where: { order: { userId: { in: ids } } },
    });

    await prisma.payment.deleteMany({
      where: { order: { userId: { in: ids } } },
    });

    await prisma.order.deleteMany({
      where: { userId: { in: ids } },
    });

    await prisma.cartLine.deleteMany({
      where: { cart: { userId: { in: ids } } },
    });

    await prisma.cart.deleteMany({
      where: { userId: { in: ids } },
    });

    await prisma.wishlistItem.deleteMany({
      where: { wishlist: { userId: { in: ids } } },
    });

    await prisma.wishlist.deleteMany({
      where: { userId: { in: ids } },
    });

    await prisma.review.deleteMany({
      where: { userId: { in: ids } },
    });

    await prisma.address.deleteMany({
      where: { userId: { in: ids } },
    });

    // Finally, delete the users
    await prisma.user.deleteMany({
      where: { id: { in: ids } },
    });

    res.json({ success: true, message: "Users and all related data deleted successfully" });
  } catch (err) {
    next(err);
  }
});


export default router;
