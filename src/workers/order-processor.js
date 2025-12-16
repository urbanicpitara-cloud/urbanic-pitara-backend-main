import { Worker } from 'bullmq';
import { redisClient } from '../lib/redis.js';
import prisma from '../lib/prisma.js';
import { sendOrderConfirmationEmail } from '../lib/email.js';
import { Prisma, OrderStatus } from '@prisma/client';

/**
 * Order Processing Worker
 * Processes queued orders in the background
 */
export const orderWorker = redisClient
  ? new Worker(
      'orders',
      async (job) => {
        const { orderData, userId } = job.data;
        
        console.log(`📦 Processing order job ${job.id}...`);

        try {
          // Extract order data
          const {
            cartLinesSource,
            totalAmount,
            currency,
            shippingAddrId,
            billingAddrId,
            appliedDiscount,
            discountAmount,
            orderNumber,
            paymentMethod,
          } = orderData;

          // Create order in transaction
          const orderWithPayment = await prisma.$transaction(async (tx) => {
            // Create order
            const newOrder = await tx.order.create({
              data: {
                orderNumber,
                userId,
                status: OrderStatus.PENDING,
                totalAmount,
                totalCurrency: currency,
                shippingAddressId: shippingAddrId,
                billingAddressId: billingAddrId,
                ...(appliedDiscount && {
                  appliedDiscountId: appliedDiscount.id,
                  discountAmount: discountAmount.toFixed(2),
                }),
                items: {
                  create: cartLinesSource.map((line) => ({
                    productId: line.productId || null,
                    variantId: line.variantId || null,
                    customProductId: line.customProductId || null,
                    quantity: line.quantity,
                    priceAmount: new Prisma.Decimal(line.priceAmount),
                    priceCurrency: line.priceCurrency,
                  })),
                },
              },
              include: {
                items: {
                  include: {
                    product: { include: { images: { take: 1 } } },
                    variant: true,
                    customProduct: true,
                  },
                },
                shippingAddress: true,
                billingAddress: true,
                appliedDiscount: true,
                user: true,
              },
            });

            // Decrement inventory
            for (const item of cartLinesSource) {
              if (item.customProductId) continue;

              if (item.variantId) {
                await tx.productVariant.update({
                  where: { id: item.variantId },
                  data: { inventoryQuantity: { decrement: item.quantity } },
                });
              } else if (item.productId) {
                const variant = await tx.productVariant.findFirst({
                  where: { productId: item.productId },
                });
                if (variant) {
                  await tx.productVariant.update({
                    where: { id: variant.id },
                    data: { inventoryQuantity: { decrement: item.quantity } },
                  });
                }
              }
            }

            // Create payment record
            const methodUpper = (paymentMethod || 'COD').toUpperCase();
            const isExternalProvider = methodUpper === 'PHONEPE';

            const newPayment = await tx.payment.create({
              data: {
                orderId: newOrder.id,
                method: methodUpper || 'COD',
                provider: isExternalProvider ? 'PHONEPE' : null,
                amount: new Prisma.Decimal(totalAmount),
                currency,
                status: methodUpper === 'COD' || isExternalProvider ? 'INITIATED' : 'PAID',
              },
            });

            return { ...newOrder, payment: newPayment };
          });

          // Send confirmation email
          await sendOrderConfirmationEmail(orderWithPayment);

          console.log(`✅ Order ${orderWithPayment.id} processed successfully`);
          
          return { success: true, orderId: orderWithPayment.id };
        } catch (error) {
          console.error(`❌ Order processing failed:`, error);
          throw error; // BullMQ will retry
        }
      },
      {
        connection: redisClient,
        concurrency: 5, // Process up to 5 orders simultaneously
        limiter: {
          max: 30, // Max 30 jobs per minute
          duration: 60000,
        },
      }
    )
  : null;

// Worker event handlers
if (orderWorker) {
  orderWorker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed`);
  });

  orderWorker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
  });

  orderWorker.on('error', (err) => {
    console.error('Worker error:', err);
  });
}

export default orderWorker;
