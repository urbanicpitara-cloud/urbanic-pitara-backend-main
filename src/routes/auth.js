import { Router } from "express";
import prisma from "../lib/prisma.js";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import {
  isAuthenticated,
  generateToken,
  setAuthCookie,
  clearAuthCookie,
} from "../middleware/auth.js";
import { sendWelcomeEmail, sendPasswordResetEmail } from "../lib/email.js";

const router = Router();

/** Utility to strip sensitive fields */
const sanitizeUser = (user) => {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
};

/** Utility to validate email and password strength */
const isStrongPassword = (password) => {
  // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
  if (password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
};

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
        .json({ error: "Password must be at least 8 characters long and contain uppercase, lowercase, and numbers" });

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
    
    // Send welcome email (fire and forget)
    sendWelcomeEmail(user).catch(err => console.error("Failed to send welcome email:", err));

    res.status(201).json({
      user: sanitizeUser(user),
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
        .json({ error: "New password must be at least 8 characters long and contain uppercase, lowercase, and numbers" });

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


/**
 * 📧 Forgot Password
 * Step 1: Request a reset link
 */
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    // Always respond success (security best practice)
    if (!user)
      return res.json({ message: "If this email exists, a reset link was sent." });

    // Generate token & expiry
    const resetToken = randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    // Construct frontend reset link
    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password?token=${resetToken}`;

    // Try to send the reset link via email. Use centralized service.
    try {
      await sendPasswordResetEmail(user, resetLink);

      // In production don't return the reset link in the response.
      const includeLink = process.env.NODE_ENV !== "production";
      res.json({
        message: "Password reset link generated.",
        ...(includeLink ? { resetLink } : {}),
      });
    } catch (emailErr) {
      // If sending fails, log for debugging and still return generic success
      console.error("Failed to send reset email:", emailErr);
      console.log("🔗 Password reset link (fallback):", resetLink);
      res.json({ message: "Password reset link generated." });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * 🔐 Reset Password
 * Step 2: Reset password using token
 */
router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword)
      return res
        .status(400)
        .json({ error: "Token and new password are required" });

    if (!isStrongPassword(newPassword))
      return res
        .status(400)
        .json({ error: "New password must be at least 6 characters long" });

    // Find user with valid token
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user)
      return res.status(400).json({ error: "Invalid or expired reset token" });

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    res.json({ message: "Password reset successful" });
  } catch (err) {
    next(err);
  }
});

// admin get all users

router.get("/admin/all/users",isAuthenticated, async (req, res, next) => {
  try {
    if(!req.user.isAdmin){
    return res.json({
      success:false,
      message:"not allowed admin only"
    });

    }

    const users = await prisma.user.findMany();
    if (!users)
     {
       return res.status(404).json({ message: "No users Found",users:[] });
     }

    res.json({
      success:true,
      users
    });
  } catch (err) {
    next(err);
  }
});

export default router;
