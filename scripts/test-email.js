import { sendWelcomeEmail, sendPasswordResetEmail, sendOrderConfirmationEmail, sendAdminGeneratedPasswordEmail } from "../src/lib/email.js";
// Mock user and order data
const mockUser = {
  email: "test@example.com",
  firstName: "Test User",
  id: "user-123"
};

const mockOrder = {
  orderNumber: "ORD-TEST-123",
  totalAmount: "1000.00",
  totalCurrency: "INR",
  user: mockUser,
  items: [
    {
      product: { title: "Test Product" },
      quantity: 1,
      priceAmount: "500.00",
      priceCurrency: "INR"
    },
    {
      customProduct: { title: "Custom Tee" },
      quantity: 1,
      priceAmount: "500.00",
      priceCurrency: "INR"
    }
  ]
};

async function runTests() {
  console.log("🚀 Starting Email Service Tests...");
  console.log("Checking for SMTP config...");
  
  if (!process.env.SMTP_HOST) {
    console.log("ℹ️  SMTP_HOST not set. Expecting fallback logger output.");
  } else {
    console.log("✅ SMTP_HOST found. Attempting real email sending.");
  }

  console.log("\n1. Testing Welcome Email...");
  await sendWelcomeEmail(mockUser);

  console.log("\n2. Testing Password Reset Email...");
  await sendPasswordResetEmail(mockUser, "http://localhost:3000/reset?token=xyz");

  console.log("\n3. Testing Admin Generated Password Email...");
  await sendAdminGeneratedPasswordEmail(mockUser, "random-password-123");

  console.log("\n4. Testing Order Confirmation Email...");
  await sendOrderConfirmationEmail(mockOrder);

  console.log("\n✅ Tests Completed.");
}

runTests().catch(console.error);
