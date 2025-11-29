import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function updateCurrency() {
  try {
    const product = await prisma.product.update({
      where: { handle: 'custom-hoodie-base' },
      data: {
        minPriceAmount: 899,
        minPriceCurrency: 'INR',
        maxPriceAmount: 899,
        maxPriceCurrency: 'INR',
      }
    });

    console.log('✅ Updated Custom Hoodie currency to INR');
    console.log('Price: ₹899');
    console.log('Product ID:', product.id);
  } catch (error) {
    console.error('❌ Error updating product:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateCurrency();
