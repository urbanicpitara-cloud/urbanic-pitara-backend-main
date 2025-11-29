import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkCart() {
  try {
    const cartId = 'cmifl7fzw0000wajot1nv00a3';
    
    // Get cart with ALL lines
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        lines: {
          include: {
            product: true,
            variant: true,
            customProduct: {
              include: {
                design: true
              }
            }
          }
        }
      }
    });

    console.log('📊 Cart Info:');
    console.log('  ID:', cart?.id);
    console.log('  Total Quantity:', cart?.totalQuantity);
    console.log('  Lines Count:', cart?.lines.length);
    console.log('\n📦 Cart Lines:');
    
    cart?.lines.forEach((line, i) => {
      console.log(`\n  Line ${i + 1}:`);
      console.log('    ID:', line.id);
      console.log('    Product ID:', line.productId);
      console.log('    Product Title:', line.product.title);
      console.log('    Variant ID:', line.variantId);
      console.log('    Custom Product ID:', line.customProductId);
      console.log('    Has Custom Product:', !!line.customProduct);
      if (line.customProduct) {
        console.log('    Custom Product Color:', line.customProduct.color);
        console.log('    Custom Product Preview:', line.customProduct.previewUrl);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkCart();
