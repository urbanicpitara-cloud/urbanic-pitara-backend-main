import prisma from '../src/lib/prisma.js';
import fs from 'fs/promises';
import path from 'path';

async function restore() {
  try {
    console.log('♻️ Starting collection restore...');

    const filePath = path.join(process.cwd(), 'scripts', 'backup_collections.json');
    const data = await fs.readFile(filePath, 'utf-8');
    const { products } = JSON.parse(data);

    console.log(`📦 Found ${products.length} products to restore.`);

    let successCount = 0;
    let failCount = 0;

    for (const p of products) {
      if (!p.collectionId) continue;

      try {
        // Connect the product to the collection using the new many-to-many relation
        // implicitly provided by Prisma when we change 'collection' to 'collections'
        await prisma.product.update({
          where: { id: p.id },
          data: {
            collections: {
              connect: { id: p.collectionId }
            }
          }
        });
        successCount++;
      } catch (err) {
        console.error(`❌ Failed to restore product ${p.title} (${p.id}):`, err.message);
        failCount++;
      }
    }

    console.log(`✅ Restore complete. Success: ${successCount}, Failed: ${failCount}`);

  } catch (error) {
    console.error('❌ Restore failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

restore();
