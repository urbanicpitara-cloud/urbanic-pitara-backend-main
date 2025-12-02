import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/customizer/config
// Return all printable products, variants, views, and art assets
router.get('/config', async (req, res) => {
  try {
    const [products, artCategories] = await Promise.all([
      prisma.printableProduct.findMany({
        include: {
          variants: {
            include: {
              views: true
            }
          }
        }
      }),
      prisma.artCategory.findMany({
        include: {
          assets: true
        }
      })
    ]);

    // Fallback logic: If no products in DB, return empty array (Frontend handles fallback)
    // or we could return the static structure here if we wanted to move logic to backend completely.
    // For now, let's return the DB data as is.

    res.json({
      products,
      artCategories
    });
  } catch (error) {
    console.error('Error fetching customizer config:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// GET /api/customizer/templates
// Return HoodieTemplate rows grouped by color (LEGACY SUPPORT)
router.get('/templates', async (req, res) => {
  try {
    const templates = await prisma.hoodieTemplate.findMany();
    
    // Group by color
    const grouped = templates.reduce((acc, template) => {
      if (!acc[template.color]) {
        acc[template.color] = {};
      }
      acc[template.color][template.side] = template.imageUrl;
      return acc;
    }, {});

    res.json(grouped);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Helper to calculate price
const calculatePrice = (size, designJson) => {
  let totalPrice = 0;

  // 1. Base Price
  const s = size?.toUpperCase();
  if (s === 'L' || s === 'XL' || s === '2XL') {
    totalPrice += 999;
  } else {
    // Default to S/M price (899)
    totalPrice += 899;
  }

  // 2. Design Cost
  let elements = [];
  try {
    const sides = typeof designJson === 'string' ? JSON.parse(designJson) : designJson;
    Object.values(sides).forEach(sideElements => {
      if (Array.isArray(sideElements)) {
        elements = [...elements, ...sideElements];
      }
    });
  } catch (e) {
    console.error("Error parsing design JSON for pricing:", e);
    return totalPrice;
  }

  const CANVAS_AREA = 500 * 500;

  elements.forEach(el => {
    if (el.type === 'text') {
      totalPrice += 50;
    } else if (el.type === 'image') {
      // Calculate coverage
      // Note: el.width and el.height might be scaled by transformer in frontend
      // The frontend sends final width/height in the JSON
      const area = (el.width || 0) * (el.height || 0);
      const coverage = area / CANVAS_AREA;

      // Revised Pricing Logic
      if (coverage > 0.5) {
        totalPrice += 300;
      } else if (coverage > 0.2) {
        totalPrice += 200;
      } else {
        totalPrice += 100;
      }
      // Small (< 20%) is now chargeable (Base cost)
    }
  });

  return totalPrice;
};

// POST /api/customizer/design/create
// Create CustomProduct and Design
router.post('/design/create', async (req, res) => {
  try {
    const {
      userId,
      json,
      thumbnailUrl,
      color,
      size,
      title,
      snapshots
    } = req.body;

    if (!json || !thumbnailUrl || !color) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Calculate price server-side
    const price = calculatePrice(size, json);

    // Create CustomProduct and Design in a transaction
    const result = await prisma.$transaction(async (prisma) => {
      const customProduct = await prisma.customProduct.create({
        data: {
          userId: userId || null, // Optional user
          title: title || "Custom Hoodie",
          color,
          size: size || 'M', // Default to M if not provided
          price,
          previewUrl: thumbnailUrl,
          snapshots: snapshots || null,
          design: {
            create: {
              json,
              thumbnailUrl
            }
          }
        }
      });
      return customProduct;
    });

    res.json({ customProductId: result.id, price });
  } catch (error) {
    console.error('Error creating design:', error);
    res.status(500).json({ error: 'Failed to create design' });
  }
});

// POST /api/customizer/design/export
// Update exportUrl for CustomProduct and Design
router.post('/design/export', async (req, res) => {
  try {
    const { customProductId, exportUrl } = req.body;

    if (!customProductId || !exportUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Update both CustomProduct and Design
    await prisma.$transaction([
      prisma.customProduct.update({
        where: { id: customProductId },
        data: { exportUrl }
      }),
      prisma.design.update({
        where: { customProductId },
        data: { exportUrl }
      })
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating export URL:', error);
    res.status(500).json({ error: 'Failed to update export URL' });
  }
});

export default router;
