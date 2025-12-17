import { Resend } from 'resend';
import { getEnv, isProductionMode } from "../config/env.js";

/**
 * Configure Resend Client
 * Requires RESEND_API_KEY in environment variables
 */
const resendApiKey = process.env.RESEND_API_KEY;

if (!resendApiKey) {
  console.warn('⚠️ RESEND_API_KEY not found. Emails will be mocked.');
}

const resend = resendApiKey ? new Resend(resendApiKey) : null;

// Use verified domain in production, or onboarding address in dev/testing
// If verifying domain, update FROM_EMAIL in .env to 'Urbanic Pitara <support@urbanicpitara.com>'
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';

/**
 * Helper: Send Email via Resend
 */
async function sendEmail({ to, subject, text, html }) {
  try {
    if (resend) {
      const isProd = isProductionMode();
      const finalTo = isProd ? to : 'urbanicpitara@gmail.com';
      
      console.log(`📧 Preparing to send email...`);
      console.log(`   Mode: ${isProd ? 'Production' : 'Development/Test'}`);
      console.log(`   From: ${FROM_EMAIL}`);
      console.log(`   To (Original): ${to}`);
      console.log(`   To (Actual): ${finalTo} ${!isProd ? '(Redirected for safety)' : ''}`);

      const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: finalTo, 
        subject,
        text,
        html,
      });

      if (error) {
        console.error('❌ Resend API Error:', error);
        return false;
      }

      console.log(`📧 Email sent to ${to}: ID ${data.id}`);
      return true;
    } else {
      // Fallback for Dev/Missing Config
      console.warn("⚠️ Resend not configured. Email mocked:");
      console.log(`To: ${to}\nSubject: ${subject}\nLink/Content: ${text}`);
      return false;
    }
  } catch (error) {
    console.error("❌ Failed to send email:", error);
    return false;
  }
}

/**
 * 1. Welcome Email
 */
export async function sendWelcomeEmail(user) {
  const subject = "Welcome to Urbanic Pitara! 🎉";
  const text = `Hi ${user.firstName},\n\nWelcome to Urbanic Pitara! We're excited to have you on board.`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <h2>Welcome, ${user.firstName}! 🎉</h2>
      <p>Thank you for joining <strong>Urbanic Pitara</strong>.</p>
      <p>We're excited to have you with us. Explore our latest collections and find something you love!</p>
      <br>
      <p>Best Regards,<br>Urbanic Pitara Team</p>
    </div>
  `;

  return sendEmail({ to: user.email, subject, text, html });
}

/**
 * 2. Password Reset Email
 */
export async function sendPasswordResetEmail(user, resetLink) {
  const subject = "Reset your password";
  const text = `You requested a password reset. Click here to reset: ${resetLink}`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <h2>Reset Your Password</h2>
      <p>Hello ${user.firstName},</p>
      <p>We received a request to reset your password. Click the link below to verify your identity and set a new password:</p>
      <p>
        <a href="${resetLink}" style="background: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a>
      </p>
      <p>Or copy this link: <br> ${resetLink}</p>
      <p>If you didn't request this, purely ignore this email.</p>
    </div>
  `;

  return sendEmail({ to: user.email, subject, text, html });
}

/**
 * 3. Order Confirmation Email
 */
export async function sendOrderConfirmationEmail(order) {
  const subject = `Order Confirmation #${order.orderNumber}`;
  
  // Basic text version
  const text = `Thank you for your order, ${order.user?.firstName || 'Customer'}! \n\nOrder #${order.orderNumber} has been placed successfully.\nTotal: ${order.totalCurrency} ${order.totalAmount}\n\nWe will notify you when it ships.`;
  
  // HTML version with item list
  const itemsHtml = order.items.map(item => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">
        ${item.product?.title || item.customProduct?.title || 'Product'} 
        ${item.variant ? `(${item.variant.title || ''})` : ''}
      </td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">x${item.quantity}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">
        ${item.priceCurrency} ${item.priceAmount}
      </td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
      <h2>Order Confirmed! ✅</h2>
      <p>Hi ${order.user?.firstName || 'there'},</p>
      <p>Thank you for shopping with us. Your order <strong>#${order.orderNumber}</strong> has been received.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <thead>
          <tr style="background: #f9f9f9; text-align: left;">
            <th style="padding: 8px;">Item</th>
            <th style="padding: 8px;">Qty</th>
            <th style="padding: 8px;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <h3 style="text-align: right; margin-top: 20px;">Total: ${order.totalCurrency} ${order.totalAmount}</h3>

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p>We will send you another email when your order ships.</p>
      <p>Best,<br>Urbanic Pitara</p>
    </div>
  `;

  return sendEmail({ to: order.user?.email || order.shippingAddress?.email, subject, text, html });
}

/**
 * 4. Admin Generated Password Email
 */
export async function sendAdminGeneratedPasswordEmail(user, newPassword) {
  const subject = "Your New Password";
  const text = `Hello ${user.firstName},\n\nYour password has been reset by an administrator. \n\nYour new password is: ${newPassword}\n\nPlease log in and change it immediately.`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <h2>Password Reset by Admin</h2>
      <p>Hello ${user.firstName},</p>
      <p>Your password has been reset by an administrator.</p>
      <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; font-family: monospace; font-size: 18px; margin: 20px 0;">
        ${newPassword}
      </div>
      <p>Please log in using this password and change it immediately from your profile settings.</p>
    </div>
  `;

  return sendEmail({ to: user.email, subject, text, html });
}

/**
 * 5. Custom Email (Admin)
 */
export async function sendCustomEmail({ to, subject, html, text }) {
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      ${html}
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #888;">This email was sent by the Urbanic Pitara team.</p>
    </div>
  `;
  return sendEmail({ to, subject, text, html: emailHtml });
}

export default {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendOrderConfirmationEmail,
  sendAdminGeneratedPasswordEmail,
  sendCustomEmail,
};
