import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'

const prisma = new PrismaClient()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Helper: clean HTML
const stripHtml = (html) => html?.replace(/<[^>]*>/g, '') ?? ''

// Helper: create or get tag
async function createOrGetTag(tagName) {
  const handle = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const tag = await prisma.tag.upsert({
    where: { handle },
    update: {},
    create: { handle, name: tagName }
  })
  console.log(chalk.blue(`Tag processed: ${tag.name}`))
  return tag
}

async function seed() {
  try {
    console.log(chalk.green('--- STARTING SEEDING PROCESS ---'))

    const csvPath = path.join(__dirname, 'new_products.csv')
    const csvContent = fs.readFileSync(csvPath, 'utf-8')
    const records = parse(csvContent, { columns: true, skip_empty_lines: true })

    console.log(chalk.yellow(`Total CSV rows: ${records.length}`))

    // Group by product handle
    const productsMap = new Map()
    for (const record of records) {
      if (!productsMap.has(record.Handle)) {
        productsMap.set(record.Handle, { main: record, variants: [], images: [] })
      }
      const product = productsMap.get(record.Handle)

      if (record['Option1 Value']) product.variants.push(record)
      if (record['Image Src'] && !product.images.some(img => img['Image Src'] === record['Image Src'])) {
        product.images.push(record)
      }
    }

    console.log(chalk.yellow(`Unique products found: ${productsMap.size}`))

    // Default collection
    const defaultCollection = await prisma.collection.upsert({
      where: { handle: 'all' },
      update: {},
      create: { handle: 'all', title: 'All Products' }
    })
    console.log(chalk.magenta(`Default collection: ${defaultCollection.title}`))

    let productCount = 0
    for (const [handle, data] of productsMap) {
      const record = data.main

      // Tags
      const tags = record.Tags?.split(',').map(t => t.trim()).filter(Boolean) || []
      const tagConnections = await Promise.all(
        tags.map(async t => ({ tagId: (await createOrGetTag(t)).id }))
      )

      // Min/max prices
      const prices = data.variants.map(v => parseFloat(v['Variant Price'] || '0'))
      const comparePrices = data.variants.map(v => parseFloat(v['Variant Compare At Price'] || '0')).filter(p => p > 0)
      const minPrice = Math.min(...prices)
      const maxPrice = Math.max(...prices)
      const compareMin = comparePrices.length ? Math.min(...comparePrices) : null
      const compareMax = comparePrices.length ? Math.max(...comparePrices) : null

      const product = await prisma.product.create({
        data: {
          handle,
          title: record.Title,
          description: stripHtml(record['Body (HTML)']),
          descriptionHtml: record['Body (HTML)'],
          vendor: record.Vendor,
          published: record.Published === 'TRUE',
          publishedAt: record.Published === 'TRUE' ? new Date() : null,
          collections: {
            connect: { id: defaultCollection.id }
          },
          featuredImageUrl: record['Image Src'],
          featuredImageAlt: record['Image Alt Text'],
          minPriceAmount: minPrice,
          maxPriceAmount: maxPrice,
          minPriceCurrency: 'INR',
          maxPriceCurrency: 'INR',
          compareMinAmount: compareMin,
          compareMaxAmount: compareMax,
          compareMinCurrency: 'INR',
          compareMaxCurrency: 'INR',
          tags: { create: tagConnections },
          metafields: {
            productCategory: record['Product Category'],
            ageGroup: record['Age group (product.metafields.shopify.age-group)'],
            color: record['Color (product.metafields.shopify.color-pattern)'],
            condition: record['Condition (product.metafields.shopify.condition)'],
            dressOccasion: record['Dress occasion (product.metafields.shopify.dress-occasion)'],
            dressStyle: record['Dress style (product.metafields.shopify.dress-style)'],
            fabric: record['Fabric (product.metafields.shopify.fabric)'],
            neckline: record['Neckline (product.metafields.shopify.neckline)'],
            pantsLengthType: record['Pants length type (product.metafields.shopify.pants-length-type)'],
            scarfShawlStyle: record['Scarf/Shawl style (product.metafields.shopify.scarf-shawl-style)'],
            size: record['Size (product.metafields.shopify.size)'],
            skirtDressLengthType: record['Skirt/Dress length type (product.metafields.shopify.skirt-dress-length-type)'],
            sleeveLengthType: record['Sleeve length type (product.metafields.shopify.sleeve-length-type)'],
            targetGender: record['Target gender (product.metafields.shopify.target-gender)'],
            topLengthType: record['Top length type (product.metafields.shopify.top-length-type)'],
            waistRise: record['Waist rise (product.metafields.shopify.waist-rise)']
          },
          variants: {
            create: data.variants.map(v => ({
              sku: v['Variant SKU'],
              priceAmount: parseFloat(v['Variant Price']),
              priceCurrency: 'INR',
              compareAmount: parseFloat(v['Variant Compare At Price'] || '0'),
              compareCurrency: 'INR',
              inventoryQuantity: parseInt(v['Variant Inventory Qty'] || '0'),
              weightInGrams: parseInt(v['Variant Grams'] || '0'),
              selectedOptions: { size: v['Option1 Value'] }
            }))
          },
          images: { create: data.images.map(i => ({ url: i['Image Src'], altText: i['Image Alt Text'] })) },
          options: {
            create: [{ name: 'Size', values: { create: data.variants.map(v => ({ name: v['Option1 Value'] })) } }]
          }
        }
      })

      productCount++
      console.log(chalk.green(`Created product #${productCount}: ${product.title}`))
    }

    console.log(chalk.green.bold(`--- SEEDING COMPLETED: ${productCount} products created ---`))
  } catch (err) {
    console.error(chalk.red('Seeding failed:'), err)
    throw err
  } finally {
    await prisma.$disconnect()
  }
}

seed()
