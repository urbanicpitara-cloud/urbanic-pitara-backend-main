const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setupBaseProduct() {
  try {
    // Check if a "Custom Hoodie" product already exists
    let baseProduct = await prisma.product.findFirst({
      where: {
        handle: "custom-hoodie-base"
      }
    });

    if (baseProduct) {
      console.log("✅ Base hoodie product already exists:");
      console.log(`   ID: ${baseProduct.id}`);
      console.log(`   Title: ${baseProduct.title}`);
      return baseProduct.id;
    }

    // Create a new base product for custom hoodies
    console.log("Creating base hoodie product...");
    baseProduct = await prisma.product.create({
      data: {
        handle: "custom-hoodie-base",
        title: "Custom Hoodie",
        description: "Design your own custom hoodie",
        published: false, // Hidden from catalog
        minPriceAmount: 49.99,
        minPriceCurrency: "USD",
        maxPriceAmount: 49.99,
        maxPriceCurrency: "USD",
      }
    });

    console.log("✅ Base hoodie product created:");
    console.log(`   ID: ${baseProduct.id}`);
    console.log(`   Title: ${baseProduct.title}`);
    
    return baseProduct.id;
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

setupBaseProduct();
