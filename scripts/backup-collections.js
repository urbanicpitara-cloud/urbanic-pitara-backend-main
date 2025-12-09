import prisma from '../src/lib/prisma.js';
import fs from 'fs/promises';
import path from 'path';

async function backup() {
  try {
    console.log('📦 Starting collection backup...');
    
    // Fetch all products that have a collectionId
    const products = await prisma.product.findMany({
      where: {
        collectionId: {
          not: null
        }
      },
      select: {
        id: true,
        collectionId: true,
        title: true
      }
    });

    console.log(`✅ Found ${products.length} products with collections.`);

    const backupData = {
      timestamp: new Date().toISOString(),
      products: products
    };

    const filePath = path.join(process.cwd(), 'scripts', 'backup_collections.json');
    await fs.writeFile(filePath, JSON.stringify(backupData, null, 2));

    console.log(`💾 Backup saved to ${filePath}`);
    
  } catch (error) {
    console.error('❌ Backup failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

backup();
