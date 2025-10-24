import { Router } from "express";
import prisma from "../lib/prisma.js";
import bcrypt from "bcrypt";
import {
  isAuthenticated,
  generateToken,
  setAuthCookie,
  clearAuthCookie,
} from "../middleware/auth.js";

const router = Router();

/** Utility to strip sensitive fields */
const sanitizeUser = (user) => {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
};

/** Utility to validate email and password strength */
const isStrongPassword = (password) => password.length >= 6; // You can use zxcvbn or stricter rules

/**
 * 🧾 Register / Signup
 */
router.post(["/register", "/signup"], async (req, res, next) => {
  try {
    let { email, password, firstName, lastName, phone } = req.body;

    email = email?.trim().toLowerCase();
    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required" });

    if (!isStrongPassword(password))
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters long" });

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
      return res
        .status(400)
        .json({ error: "User with this email already exists" });

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: { email, passwordHash, firstName, lastName, phone },
    });

    // Generate token + set cookie
    const token = generateToken(user.id);
    setAuthCookie(res, token);

    res.status(201).json({
      user: sanitizeUser(user),
      token,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 🔑 Login
 */
router.post("/login", async (req, res, next) => {
  try {
    let { email, password } = req.body;
    email = email?.trim().toLowerCase();

    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
      return res.status(401).json({ error: "Invalid email or password" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid)
      return res.status(401).json({ error: "Invalid email or password" });

    const token = generateToken(user.id);
    setAuthCookie(res, token);

    res.json({
      user: sanitizeUser(user),
      token,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 🚪 Logout
 */
router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ message: "Logged out successfully" });
});

/**
 * 👤 Get Current User
 */
router.get("/me", isAuthenticated, async (req, res) => {
  res.json(sanitizeUser(req.user));
});

/**
 * 🧾 Update Profile
 */
router.put("/me", isAuthenticated, async (req, res, next) => {
  try {
    const { firstName, lastName, phone } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { firstName, lastName, phone },
    });

    res.json(sanitizeUser(updated));
  } catch (err) {
    next(err);
  }
});

/**
 * 🔒 Change Password
 */
router.put("/change-password", isAuthenticated, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword)
      return res
        .status(400)
        .json({ error: "Current password and new password are required" });

    if (!isStrongPassword(newPassword))
      return res
        .status(400)
        .json({ error: "New password must be at least 6 characters long" });

    const valid = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!valid)
      return res.status(401).json({ error: "Current password is incorrect" });

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash },
    });

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    next(err);
  }
});

export default router;
