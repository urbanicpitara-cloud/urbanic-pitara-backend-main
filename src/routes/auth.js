import { Router } from "express";
import prisma from "../lib/prisma.js";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import nodemailer from "nodemailer";
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
 * Helper: sendResetEmail
 * Uses SMTP configuration from environment variables:
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL
 * If SMTP isn't configured, it falls back to logging the reset link (developer mode).
 */
async function sendResetEmail({ to, resetLink }) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.FROM_EMAIL || user || `no-reply@${process.env.FRONTEND_URL?.replace(/^https?:\/\//, '') || 'localhost'}`;

  if (!host || !user || !pass) {
    console.warn('SMTP not configured. Falling back to console output for reset link.');
    console.log('Password reset link:', resetLink);
    return;
  }

  const secure = process.env.SMTP_SECURE === 'true' || (port === 465);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  const mailOptions = {
    from,
    to,
    subject: 'Password reset request',
    text: `You requested a password reset. Use the link below to reset your password:\n\n${resetLink}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>You requested a password reset. Click the link below to reset your password:</p><p><a href="${resetLink}">Reset password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  };

  await transporter.sendMail(mailOptions);
}

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

    // Try to send the reset link via email. Use SMTP config from env vars.
    // If SMTP is not configured, fall back to logging the link (developer mode).
    try {
      await sendResetEmail({
        to: user.email,
        resetLink,
      });

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
