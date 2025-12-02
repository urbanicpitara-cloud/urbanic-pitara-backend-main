import express from 'express';
import { PrismaClient } from '@prisma/client';
import { deleteImage } from '../lib/cloudinary.js';

const router = express.Router();
const prisma = new PrismaClient();

// ==========================================
// PRINTABLE PRODUCTS (e.g. Hoodies, T-Shirts)
// ==========================================

// GET /api/admin/customizer/products
router.get('/products', async (req, res) => {
  try {
    const products = await prisma.printableProduct.findMany({
      include: {
        variants: {
          include: {
            views: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(products);
  } catch (error) {
    console.error('Error fetching printable products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// POST /api/admin/customizer/products
router.post('/products', async (req, res) => {
  try {
    const { name, description, basePrice } = req.body;
    const product = await prisma.printableProduct.create({
      data: {
        name,
        description,
        basePrice
      }
    });
    res.json(product);
  } catch (error) {
    console.error('Error creating printable product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// DELETE /api/admin/customizer/products/:id
router.delete('/products/:id', async (req, res) => {
  try {
    await prisma.printableProduct.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting printable product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ==========================================
// VARIANTS (Colors)
// ==========================================

// POST /api/admin/customizer/products/:id/variants
router.post('/products/:id/variants', async (req, res) => {
  try {
    const { colorName, colorHex } = req.body;
    const variant = await prisma.printableVariant.create({
      data: {
        printableProductId: req.params.id,
        colorName,
        colorHex
      }
    });
    res.json(variant);
  } catch (error) {
    console.error('Error creating variant:', error);
    res.status(500).json({ error: 'Failed to create variant' });
  }
});

// DELETE /api/admin/customizer/variants/:id
router.delete('/variants/:id', async (req, res) => {
  try {
    // Get variant with views to delete images from Cloudinary
    const variant = await prisma.printableVariant.findUnique({
      where: { id: req.params.id },
      include: { views: true }
    });
    
    if (variant) {
      // Delete all view images from Cloudinary
      for (const view of variant.views) {
        await deleteImage(view.imageUrl);
      }
    }
    
    await prisma.printableVariant.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting variant:', error);
    res.status(500).json({ error: 'Failed to delete variant' });
  }
});

// ==========================================
// VIEWS (Sides)
// ==========================================

// POST /api/admin/customizer/variants/:id/views
router.post('/variants/:id/views', async (req, res) => {
  try {
    const { side, imageUrl } = req.body;
    const view = await prisma.printableView.create({
      data: {
        printableVariantId: req.params.id,
        side,
        imageUrl
      }
    });
    res.json(view);
  } catch (error) {
    console.error('Error creating view:', error);
    res.status(500).json({ error: 'Failed to create view' });
  }
});

// DELETE /api/admin/customizer/views/:id
router.delete('/views/:id', async (req, res) => {
  try {
    // Get view to delete image from Cloudinary
    const view = await prisma.printableView.findUnique({
      where: { id: req.params.id }
    });
    
    if (view) {
      await deleteImage(view.imageUrl);
    }
    
    await prisma.printableView.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting view:', error);
    res.status(500).json({ error: 'Failed to delete view' });
  }
});

// ==========================================
// ART CATEGORIES & ASSETS
// ==========================================

// GET /api/admin/customizer/categories
router.get('/categories', async (req, res) => {
  try {
    const categories = await prisma.artCategory.findMany({
      include: {
        assets: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/admin/customizer/categories
router.post('/categories', async (req, res) => {
  try {
    const { name } = req.body;
    const category = await prisma.artCategory.create({
      data: { name }
    });
    res.json(category);
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// DELETE /api/admin/customizer/categories/:id
router.delete('/categories/:id', async (req, res) => {
  try {
    console.log('🗑️ Deleting category:', req.params.id);
    
    // Get category with assets to delete images from Cloudinary
    const category = await prisma.artCategory.findUnique({
      where: { id: req.params.id },
      include: { assets: true }
    });
    
    console.log('📦 Category found with', category?.assets?.length || 0, 'assets');
    
    if (category) {
      // Delete all asset images from Cloudinary
      console.log('🖼️ Deleting', category.assets.length, 'images from Cloudinary');
      for (const asset of category.assets) {
        console.log('  → Deleting:', asset.url);
        await deleteImage(asset.url);
      }
    }
    
    await prisma.artCategory.delete({
      where: { id: req.params.id }
    });
    console.log('✅ Category deleted successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// POST /api/admin/customizer/categories/:id/assets
router.post('/categories/:id/assets', async (req, res) => {
  try {
    const { url, name } = req.body;
    const asset = await prisma.artAsset.create({
      data: {
        categoryId: req.params.id,
        url,
        name
      }
    });
    res.json(asset);
  } catch (error) {
    console.error('Error creating art asset:', error);
    res.status(500).json({ error: 'Failed to create art asset' });
  }
});

// DELETE /api/admin/customizer/assets/:id
router.delete('/assets/:id', async (req, res) => {
  try {
    console.log('🗑️ Deleting asset:', req.params.id);
    
    // Get asset to delete image from Cloudinary
    const asset = await prisma.artAsset.findUnique({
      where: { id: req.params.id }
    });
    
    console.log('📦 Asset found:', asset);
    
    if (asset) {
      console.log('🖼️ Deleting image from Cloudinary:', asset.url);
      await deleteImage(asset.url);
    }
    
    await prisma.artAsset.delete({
      where: { id: req.params.id }
    });
    console.log('✅ Asset deleted successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting art asset:', error);
    res.status(500).json({ error: 'Failed to delete art asset' });
  }
});

export default router;
