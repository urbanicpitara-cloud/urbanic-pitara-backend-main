import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function createBaseCustomHoodie() {
  try {
    // Check if it already exists
    const existing = await prisma.product.findUnique({
      where: { handle: 'custom-hoodie-base' }
    });

    if (existing) {
      console.log('✅ Base Custom Hoodie already exists!');
      console.log('Product ID:', existing.id);
      return existing.id;
    }

    // Create the base product
    const product = await prisma.product.create({
      data: {
        handle: 'custom-hoodie-base',
        title: 'Custom Hoodie',
        description: 'A custom hoodie designed by you',
        vendor: 'Urbanic Pitara',
        published: false, // Don't show in regular product listings
        minPriceAmount: 49.99,
        minPriceCurrency: 'USD',
        maxPriceAmount: 49.99,
        maxPriceCurrency: 'USD',
        featuredImageUrl: '/hoodies/black/front.png',
        featuredImageAlt: 'Custom Hoodie',
      }
    });

    console.log('✅ Base Custom Hoodie product created successfully!');
    console.log('Product ID:', product.id);
    console.log('\nCopy this ID and update BASE_HOODIE_PRODUCT_ID in page.tsx');
    
    return product.id;
  } catch (error) {
    console.error('❌ Error creating base product:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createBaseCustomHoodie();
