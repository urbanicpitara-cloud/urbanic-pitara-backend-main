import { sendCustomEmail, sendOrderConfirmationEmail } from "../src/lib/email.js";

// Mock data
const mockUser = {
  email: "test@example.com",
  firstName: "Admin Test User",
};

const mockOrder = {
  id: "order-123",
  orderNumber: "ORD-ADMIN-INVOICE",
  totalAmount: "2500.00",
  totalCurrency: "INR",
  user: mockUser,
  items: [
    {
      product: { title: "Premium Item" },
      quantity: 2,
      priceAmount: "1250.00",
      priceCurrency: "INR"
    }
  ]
};

async function runTests() {
  console.log("🚀 Starting Admin Email Tests...");

  console.log("\n1. Testing Custom Email (Text)...");
  await sendCustomEmail({
    to: mockUser.email,
    subject: "Important Update",
    text: "This is a plain text message from the admin panel.",
    html: "<p>This is a <strong>HTML</strong> message from the admin panel.</p>"
  });

  console.log("\n2. Testing Invoice Resend...");
  await sendOrderConfirmationEmail(mockOrder);

  console.log("\n✅ Admin Email Tests Completed.");
}

runTests().catch(console.error);
