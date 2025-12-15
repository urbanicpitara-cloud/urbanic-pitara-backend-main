import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { promises as dnsPromises } from 'dns';
import prisma from "../lib/prisma.js";
import { isAuthenticated, isAdmin } from '../middleware/auth.js';
import {
  initiatePayment as initiatePhonePe,
  checkPaymentStatus as checkPhonePeStatus,
  verifyCallback as verifyPhonePeCallback,
} from '../lib/phonepe.js';
import * as razorpay from '../lib/razorpay.js';
import * as stripe from '../lib/stripe.js';

const router = Router();

/**
 * Initiate payment
 * POST /api/payment/initiate
 * Supports multiple providers: PHONEPE, RAZORPAY, STRIPE
 */
router.post('/initiate', isAuthenticated, async (req, res) => {
  try {
    const { amount, orderId, provider = 'PHONEPE' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const providerUpper = provider.toUpperCase();
    // const redirectUrl removed to prevent redeclaration conflict


    // Handle different payment providers
    if (providerUpper === 'RAZORPAY') {
      // Razorpay integration
      const razorpayOrder = await razorpay.createOrder({
        amount,
        orderId,
        currency: 'INR',
      });

      // Store transaction
      await prisma.transaction.create({
        data: {
          id: razorpayOrder.id,
          amount: new Prisma.Decimal(amount),
          orderId,
          userId: req.user.id,
          status: 'PENDING',
          provider: 'RAZORPAY',
        },
      });

      return res.json({
        success: true,
        provider: 'RAZORPAY',
        data: {
          orderId: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          keyId: razorpay.getKeyId(),
          transactionId: razorpayOrder.id,
        },
      });
    }

    if (providerUpper === 'STRIPE') {
      // Stripe integration
      const paymentIntent = await stripe.createPaymentIntent({
        amount,
        orderId,
        currency: 'inr',
        customerEmail: req.user.email,
      });

      // Store transaction
      await prisma.transaction.create({
        data: {
          id: paymentIntent.id,
          amount: new Prisma.Decimal(amount),
          orderId,
          userId: req.user.id,
          status: 'PENDING',
          provider: 'STRIPE',
        },
      });

      return res.json({
        success: true,
        provider: 'STRIPE',
        data: {
          clientSecret: paymentIntent.client_secret,
          publishableKey: stripe.getPublishableKey(),
          transactionId: paymentIntent.id,
        },
      });
    }

    // Default: PhonePe
    const merchantTransactionId = `${orderId}_${uuidv4().replace(/-/g, '')}`;
    const callbackUrl = req.body.callbackUrl || `${process.env.BACKEND_URL || 'http://localhost:4000'}/payment/callback`;
    
    // Ensure redirectUrl has the transaction ID for the frontend to derive status
    const baseUrl = req.body.redirectUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/status`;
    const redirectUrl = `${baseUrl}?transactionId=${merchantTransactionId}`;

    const response = await initiatePhonePe({
      amount,
      merchantTransactionId,
      callbackUrl,
      redirectUrl,
    });

    await prisma.transaction.create({
      data: {
        id: merchantTransactionId,
        amount: new Prisma.Decimal(amount),
        orderId,
        userId: req.user.id,
        status: 'PENDING',
        provider: 'PHONEPE',
      },
    });

    let providerRedirectUrl = null;
    try {
      providerRedirectUrl =
        response?.data?.instrumentResponse?.redirectInfo?.url ||
        response?.data?.redirectUrl ||
        response?.redirectUrl ||
        redirectUrl || null;
    } catch (e) {
      providerRedirectUrl = redirectUrl || null;
    }

    if (!providerRedirectUrl) {
      console.error('PhonePe initiate response unexpected:', response);
      return res.status(500).json({ success: false, error: 'Payment initiation failed: unexpected provider response' });
    }

    try {
      const url = new URL(providerRedirectUrl);
      const hostname = url.hostname;
      await dnsPromises.lookup(hostname);
    } catch (dnsErr) {
      console.warn('Provider redirect host not resolvable, falling back to frontend redirectUrl:', dnsErr?.message || dnsErr);
      providerRedirectUrl = redirectUrl || providerRedirectUrl;
    }

    res.json({
      success: true,
      provider: 'PHONEPE',
      data: {
        redirectUrl: providerRedirectUrl,
        transactionId: merchantTransactionId,
      },
    });
  } catch (error) {
    console.error('Payment initiation error:', error?.response || error);
    const isProd = process.env.NODE_ENV === 'production';
    const safeMessage = isProd ? 'Payment initiation failed' : (error?.response?.data || error?.message || String(error));
    res.status(500).json({
      success: false,
      error: safeMessage,
    });
  }
});

/**
 * Payment callback from PhonePe
 * POST /api/payment/callback
 */
router.post('/callback', async (req, res) => {
  try {
    const { response } = req.body;
    const xVerify = req.headers['x-verify'];

    // Verify callback signature
    if (!verifyPhonePeCallback(response, xVerify)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(Buffer.from(response, 'base64').toString());
    const { merchantTransactionId, code, status } = payload;

    // Check payment status with PhonePe
    const statusResponse = await checkPhonePeStatus(merchantTransactionId);
    const phonepeStatus = statusResponse.data.state; // COMPLETED, FAILED, etc.

    // Map PhonePe status to our Payment status enum
    const paymentStatusMap = {
      COMPLETED: 'PAID',
      FAILED: 'FAILED',
      PENDING: 'INITIATED',
    };
    const mappedPaymentStatus = paymentStatusMap[phonepeStatus] || 'INITIATED';

    // Get the transaction to find the orderId
    const transaction = await prisma.transaction.findUnique({
      where: { id: merchantTransactionId },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Update transaction status (what PhonePe returns)
    await prisma.transaction.update({
      where: { id: merchantTransactionId },
      data: {
        status: phonepeStatus === 'COMPLETED' ? 'COMPLETED' : phonepeStatus,
        responseCode: code,
        responseMessage: status,
        updatedAt: new Date(),
      },
    });

    // Update the Payment record with our user-facing status
    const payment = await prisma.payment.findFirst({
      where: { orderId: transaction.orderId },
    });

    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: mappedPaymentStatus,
          updatedAt: new Date(),
        },
      });

      // If payment is successful, update order status
      if (mappedPaymentStatus === 'PAID') {
        await prisma.order.update({
          where: { id: transaction.orderId },
          data: { status: 'PROCESSING' },
        });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Payment callback error:', error);
    res.status(500).json({
      success: false,
      error: 'Payment callback processing failed',
    });
  }
});

/**
 * Razorpay payment verification
 * POST /api/payment/verify/razorpay
 */
router.post('/verify/razorpay', isAuthenticated, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify signature
    const isValid = razorpay.verifyPaymentSignature({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Get transaction
    const transaction = await prisma.transaction.findUnique({
      where: { id: razorpay_order_id },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Update transaction
    await prisma.transaction.update({
      where: { id: razorpay_order_id },
      data: {
        status: 'COMPLETED',
        responseCode: razorpay_payment_id,
        updatedAt: new Date(),
      },
    });

    // Update payment
    const payment = await prisma.payment.findFirst({
      where: { orderId: transaction.orderId },
    });

    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PAID',
          providerPaymentId: razorpay_payment_id,
          updatedAt: new Date(),
        },
      });

      // Update order status
      await prisma.order.update({
        where: { id: transaction.orderId },
        data: { status: 'PROCESSING' },
      });
    }

    res.json({ success: true, verified: true });
  } catch (error) {
    console.error('Razorpay verification error:', error);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

/**
 * Stripe payment confirmation
 * POST /api/payment/confirm/stripe
 */
router.post('/confirm/stripe', isAuthenticated, async (req, res) => {
  try {
    const { payment_intent_id } = req.body;

    if (!payment_intent_id) {
      return res.status(400).json({ error: 'Missing payment intent ID' });
    }

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.retrievePaymentIntent(payment_intent_id);

    // Get transaction
    const transaction = await prisma.transaction.findUnique({
      where: { id: payment_intent_id },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Map Stripe status
    const statusMap = {
      succeeded: 'COMPLETED',
      processing: 'PENDING',
      requires_payment_method: 'PENDING',
      requires_confirmation: 'PENDING',
      requires_action: 'PENDING',
      canceled: 'FAILED',
      failed: 'FAILED',
    };

    const transactionStatus = statusMap[paymentIntent.status] || 'PENDING';
    const paymentStatus = paymentIntent.status === 'succeeded' ? 'PAID' : 'INITIATED';

    // Update transaction
    await prisma.transaction.update({
      where: { id: payment_intent_id },
      data: {
        status: transactionStatus,
        responseCode: paymentIntent.status,
        updatedAt: new Date(),
      },
    });

    // Update payment
    const payment = await prisma.payment.findFirst({
      where: { orderId: transaction.orderId },
    });

    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: paymentStatus,
          providerPaymentId: payment_intent_id,
          updatedAt: new Date(),
        },
      });

      // Update order status if payment succeeded
      if (paymentIntent.status === 'succeeded') {
        await prisma.order.update({
          where: { id: transaction.orderId },
          data: { status: 'PROCESSING' },
        });
      }
    }

    res.json({
      success: true,
      status: paymentIntent.status,
      paymentStatus,
    });
  } catch (error) {
    console.error('Stripe confirmation error:', error);
    res.status(500).json({ success: false, error: 'Confirmation failed' });
  }
});

/**
 * Check payment status
 * GET /api/payment/status/:transactionId
 */
router.get('/status/:transactionId', isAuthenticated, async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { payment: true },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Only allow the user who created the transaction or admin to check status
    if (transaction.userId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Check latest status from PhonePe
    const response = await checkPhonePeStatus(transactionId);
    const phonepeStatus = response.data.state;

    // Map PhonePe status to our Payment status enum
    const paymentStatusMap = {
      COMPLETED: 'PAID',
      FAILED: 'FAILED',
      PENDING: 'INITIATED',
    };
    const mappedPaymentStatus = paymentStatusMap[phonepeStatus] || 'INITIATED';

    // Update transaction if status has changed
    if (phonepeStatus !== transaction.status) {
      await prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: phonepeStatus,
          updatedAt: new Date(),
        },
      });

      // Also update the Payment model
      const payment = await prisma.payment.findFirst({
        where: { orderId: transaction.orderId },
      });

      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: mappedPaymentStatus,
            updatedAt: new Date(),
          },
        });
      }
    }

    res.json({
      success: true,
      data: {
        status: mappedPaymentStatus,
        transactionStatus: phonepeStatus,
        amount: transaction.amount,
        orderId: transaction.orderId,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
      },
    });
  } catch (error) {
    console.error('Payment status check error:', error);
    res.status(500).json({
      success: false,
      error: 'Payment status check failed',
    });
  }
});

/**
 * Initiate a refund for a payment
 * POST /:paymentId/refund (mounted at /admin/payment)
 * Admin only - processes real refunds through payment providers
 */
router.post('/:paymentId/refund', isAuthenticated, isAdmin, async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const { amount, reason } = req.body;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid refund amount' });
    }

    // Get payment from database
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Check if payment is eligible for refund
    if (payment.status !== 'PAID') {
      return res.status(400).json({ error: 'Only PAID payments can be refunded' });
    }

    if (payment.refundId) {
      return res.status(400).json({ error: 'Payment already refunded' });
    }

    // Check refund amount doesn't exceed payment amount
    const paymentAmount = Number(payment.amount);
    const refundAmount = Number(amount);
    
    if (refundAmount > paymentAmount) {
      return res.status(400).json({ 
        error: `Refund amount (${refundAmount}) cannot exceed payment amount (${paymentAmount})` 
      });
    }

    // Initiate refund with payment provider
    let refundResponse;
    const amountInPaise = Math.round(refundAmount * 100); // Convert to paise

    // Determine provider from provider field or payment method
    const provider = payment.provider?.toUpperCase() || payment.method?.toUpperCase();
    
    if (!provider) {
      return res.status(400).json({ 
        error: 'Cannot determine payment provider. Payment may be too old or invalid.' 
      });
    }

    switch (provider) {
      case 'RAZORPAY':
        if (!payment.providerPaymentId) {
          return res.status(400).json({ error: 'Missing Razorpay payment ID' });
        }
        refundResponse = await razorpay.createRefund(payment.providerPaymentId, amountInPaise, reason);
        break;

      case 'STRIPE':
        if (!payment.providerPaymentId) {
          return res.status(400).json({ error: 'Missing Stripe payment intent ID' });
        }
        refundResponse = await stripe.createRefund(payment.providerPaymentId, amountInPaise, reason);
        break;

      case 'PHONEPE':
        return res.status(400).json({ error: 'PhonePe refunds must be processed manually through PhonePe dashboard' });

      case 'COD':
        return res.status(400).json({ error: 'Cannot refund COD payments through system - process cash refund manually' });

      default:
        return res.status(400).json({ 
          error: `Refunds not supported for payment method: ${provider}. Please process refund manually.` 
        });
    }

    // Update payment record with refund details
    const updatedPayment = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'REFUNDED',
        refundId: refundResponse.id,
        refundAmount: new Prisma.Decimal(refundAmount),
        refundedAt: new Date(),
        refundReason: reason || 'Admin initiated refund'
      }
    });

    // Update order status to REFUNDED
    if (payment.orderId) {
      await prisma.order.update({
        where: { id: payment.orderId },
        data: { status: 'REFUNDED' }
      });
    }

    res.json({
      success: true,
      message: 'Refund initiated successfully',
      payment: {
        id: updatedPayment.id,
        status: updatedPayment.status,
        refundId: updatedPayment.refundId,
        refundAmount: Number(updatedPayment.refundAmount),
        refundedAt: updatedPayment.refundedAt
      },
      refund: refundResponse
    });

  } catch (error) {
    console.error('Refund error:', error);
    next(error);
  }
});

export default router;

/**
 * Admin: Update payment status manually
 * Mounting note: this router is also mounted at `/admin/payment` in `src/index.js`
 * so this route is declared here as `PUT /:paymentId` (router-level) to expose
 * the admin endpoint at `/admin/payment/:paymentId`.
 */
router.put('/:paymentId', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { status } = req.body;

    if (!paymentId) return res.status(400).json({ error: 'paymentId required' });
    if (!status) return res.status(400).json({ error: 'status required' });

    const allowed = ['INITIATED', 'PAID', 'FAILED', 'REFUNDED', 'NONE'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: { status, updatedAt: new Date() },
    });

    // If marked as PAID, move order to PROCESSING if it's still PENDING
    if (status === 'PAID' && payment.orderId) {
      try {
        await prisma.order.updateMany({
          where: { id: payment.orderId, status: 'PENDING' },
          data: { status: 'PROCESSING' },
        });
      } catch (e) {
        console.warn('Failed to update order status after admin payment update', e?.message);
      }
    }

    return res.json({ success: true, payment: updated });
  } catch (error) {
    console.error('Admin update payment error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update payment' });
  }
});