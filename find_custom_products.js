import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function findCustomProducts() {
  try {
    // Find all cart lines with custom products
    const customLines = await prisma.cartLine.findMany({
      where: {
        customProductId: { not: null }
      },
      include: {
        cart: true,
        product: true,
        customProduct: true
      }
    });

    console.log(`\n🔍 Found ${customLines.length} cart lines with custom products:\n`);
    
    customLines.forEach((line, i) => {
      console.log(`  Line ${i + 1}:`);
      console.log('    Line ID:', line.id);
      console.log('    Cart ID:', line.cartId);
      console.log('    Product:', line.product.title);
      console.log('    Custom Product ID:', line.customProductId);
      console.log('    Custom Product Color:', line.customProduct?.color);
      console.log('    Quantity:', line.quantity);
      console.log('');
    });

    // Check all carts
    const allCarts = await prisma.cart.findMany({
      include: {
        lines: {
          include: {
            customProduct: true
          }
        }
      }
    });

    console.log(`\n📊 Total Carts: ${allCarts.length}\n`);
    allCarts.forEach((cart, i) => {
      console.log(`  Cart ${i + 1}:`);
      console.log('    ID:', cart.id);
      console.log('    Total Quantity:', cart.totalQuantity);
      console.log('    Actual Lines:', cart.lines.length);
      console.log('    Lines with custom products:', cart.lines.filter(l => l.customProductId).length);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

findCustomProducts();
