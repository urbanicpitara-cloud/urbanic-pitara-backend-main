import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { promises as dnsPromises } from 'dns';
import prisma from "../lib/prisma.js";
import { isAuthenticated, isAdmin } from '../middleware/auth.js';
import {
  initiatePayment,
  checkPaymentStatus,
  verifyCallback,
} from '../lib/phonepe.js';

const router = Router();

/**
 * Initiate payment
 * POST /api/payment/initiate
 */
router.post('/initiate', isAuthenticated, async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Generate a unique transaction ID
    const merchantTransactionId = `${orderId}_${uuidv4().replace(/-/g, '')}`;

    // Get callback and redirect URLs from request or use defaults
    const callbackUrl = req.body.callbackUrl || `${process.env.BACKEND_URL || 'http://localhost:4000'}/payment/callback`;
    const redirectUrl = req.body.redirectUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/status`;

    // Initiate payment with PhonePe
    const response = await initiatePayment({
      amount,
      merchantTransactionId,
      callbackUrl,
      redirectUrl,
    });

    // Store transaction details (amount as Decimal)
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

    // Safely extract redirect URL from provider response
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

    // Try resolving the provider redirect host. Some PhonePe sandbox redirect domains
    // (eg. sandbox.phonepe.com) may not be reachable from the user's network or may
    // fail DNS. If the host cannot be resolved, fall back to our frontend redirectUrl
    // so the user isn't sent to a dead page during testing.
    try {
      const url = new URL(providerRedirectUrl);
      const hostname = url.hostname;
      // perform DNS lookup with a short timeout by using Promise.race
      await dnsPromises.lookup(hostname);
    } catch (dnsErr) {
      console.warn('Provider redirect host not resolvable, falling back to frontend redirectUrl:', dnsErr?.message || dnsErr);
      providerRedirectUrl = redirectUrl || providerRedirectUrl;
    }

    // Return the payment URL to frontend
    res.json({
      success: true,
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
    if (!verifyCallback(response, xVerify)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(Buffer.from(response, 'base64').toString());
    const { merchantTransactionId, code, status } = payload;

    // Check payment status with PhonePe
    const statusResponse = await checkPaymentStatus(merchantTransactionId);
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
    const response = await checkPaymentStatus(transactionId);
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