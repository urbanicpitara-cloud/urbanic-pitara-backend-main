import Stripe from 'stripe';

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  NODE_ENV,
} = process.env;

/**
 * Check if we should use mock mode
 * Mock mode is enabled when:
 * 1. STRIPE_MOCK=true is set, OR
 * 2. No credentials are provided (development)
 */
const useMockMode = () => {
  if (process.env.STRIPE_MOCK === 'true') return true;
  if (!STRIPE_SECRET_KEY) return true;
  return false;
};

/**
 * Initialize Stripe instance
 */
const getStripeInstance = () => {
  if (useMockMode()) {
    console.log('📌 Stripe: Using MOCK mode (no credentials)');
    return null;
  }

  return new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
  });
};

/**
 * Create Stripe Payment Intent
 * @param {Object} params - Payment parameters
 * @param {number} params.amount - Amount in rupees
 * @param {string} params.orderId - Your order ID
 * @param {string} params.currency - Currency code (default: INR)
 * @param {string} params.customerEmail - Customer email (optional)
 * @returns {Promise<Object>} Stripe Payment Intent
 */
export const createPaymentIntent = async ({
  amount,
  orderId,
  currency = 'inr',
  customerEmail,
}) => {
  try {
    // Mock mode: return fake payment intent
    if (useMockMode()) {
      console.log('📌 Stripe Mock: Creating payment intent', { amount, orderId });
      return {
        id: `pi_mock_${Date.now()}`,
        object: 'payment_intent',
        amount: amount * 100, // Convert to paisa
        currency,
        status: 'requires_payment_method',
        client_secret: `pi_mock_${Date.now()}_secret_mock`,
        metadata: {
          orderId,
        },
      };
    }

    // Real mode: create actual Stripe payment intent
    const stripe = getStripeInstance();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to paisa
      currency,
      metadata: {
        orderId,
      },
      receipt_email: customerEmail,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log('✅ Stripe: Payment Intent created', paymentIntent.id);
    return paymentIntent;
  } catch (error) {
    console.error('❌ Stripe: Payment Intent creation failed', error);
    throw error;
  }
};

/**
 * Retrieve Payment Intent
 * @param {string} paymentIntentId - Stripe Payment Intent ID
 * @returns {Promise<Object>} Payment Intent details
 */
export const retrievePaymentIntent = async (paymentIntentId) => {
  try {
    // Mock mode: return fake payment intent
    if (useMockMode()) {
      console.log('📌 Stripe Mock: Retrieving payment intent', paymentIntentId);
      return {
        id: paymentIntentId,
        object: 'payment_intent',
        amount: 100000, // ₹1000
        currency: 'inr',
        status: 'succeeded',
        metadata: {},
      };
    }

    // Real mode: retrieve actual payment intent
    const stripe = getStripeInstance();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    console.log('✅ Stripe: Payment Intent retrieved', paymentIntent.id);
    return paymentIntent;
  } catch (error) {
    console.error('❌ Stripe: Payment Intent retrieval failed', error);
    throw error;
  }
};

/**
 * Confirm Payment Intent
 * @param {string} paymentIntentId - Stripe Payment Intent ID
 * @param {string} paymentMethodId - Stripe Payment Method ID
 * @returns {Promise<Object>} Confirmed Payment Intent
 */
export const confirmPaymentIntent = async (paymentIntentId, paymentMethodId) => {
  try {
    // Mock mode: return fake confirmed payment
    if (useMockMode()) {
      console.log('📌 Stripe Mock: Confirming payment intent', paymentIntentId);
      return {
        id: paymentIntentId,
        object: 'payment_intent',
        status: 'succeeded',
        amount: 100000,
        currency: 'inr',
      };
    }

    // Real mode: confirm actual payment intent
    const stripe = getStripeInstance();
    const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethodId,
    });

    console.log('✅ Stripe: Payment Intent confirmed', paymentIntent.id);
    return paymentIntent;
  } catch (error) {
    console.error('❌ Stripe: Payment Intent confirmation failed', error);
    throw error;
  }
};

/**
 * Verify webhook signature
 * @param {string} payload - Raw webhook payload
 * @param {string} signature - Stripe-Signature header
 * @returns {Object|null} Verified event or null if invalid
 */
export const verifyWebhookSignature = (payload, signature) => {
  try {
    // Mock mode: return fake event
    if (useMockMode()) {
      console.log('📌 Stripe Mock: Webhook verification (auto-pass)');
      try {
        return JSON.parse(payload);
      } catch {
        return { type: 'payment_intent.succeeded', data: {} };
      }
    }

    if (!STRIPE_WEBHOOK_SECRET) {
      console.warn('⚠️ Stripe: No webhook secret configured');
      return null;
    }

    // Real mode: verify webhook signature
    const stripe = getStripeInstance();
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      STRIPE_WEBHOOK_SECRET
    );

    console.log('✅ Stripe: Webhook verified', event.type);
    return event;
  } catch (error) {
    console.error('❌ Stripe: Webhook verification failed', error.message);
    return null;
  }
};

/**
 * Cancel Payment Intent
 * @param {string} paymentIntentId - Stripe Payment Intent ID
 * @returns {Promise<Object>} Canceled Payment Intent
 */
export const cancelPaymentIntent = async (paymentIntentId) => {
  try {
    // Mock mode: return fake canceled payment
    if (useMockMode()) {
      console.log('📌 Stripe Mock: Canceling payment intent', paymentIntentId);
      return {
        id: paymentIntentId,
        object: 'payment_intent',
        status: 'canceled',
      };
    }

    // Real mode: cancel actual payment intent
    const stripe = getStripeInstance();
    const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);
    console.log('✅ Stripe: Payment Intent canceled', paymentIntent.id);
    return paymentIntent;
  } catch (error) {
    console.error('❌ Stripe: Payment Intent cancellation failed', error);
    throw error;
  }
};

/**
 * Check if Stripe is configured
 * @returns {boolean} True if configured (has credentials or mock mode)
 */
export const isConfigured = () => {
  return useMockMode() || !!STRIPE_SECRET_KEY;
};

/**
 * Initiate a refund for a Stripe payment
 * @param {string} paymentIntentId - Stripe payment intent ID
 * @param {number} amount - Amount to refund in paise (smallest currency unit)
 * @param {string} reason - Reason for refund
 * @returns {Promise<Object>} Refund object
 */
export const createRefund = async (paymentIntentId, amount, reason = 'requested_by_customer') => {
  try {
    // Mock mode: simulate refund
    if (useMockMode()) {
      console.log('📌 Stripe Mock: Simulating refund', { paymentIntentId, amount, reason });
      return {
        id: `re_mock_${Date.now()}`,
        object: 'refund',
        payment_intent: paymentIntentId,
        amount: amount,
        currency: 'inr',
        status: 'succeeded',
        reason: reason,
        created: Math.floor(Date.now() / 1000),
        metadata: { reason }
      };
    }

    // Real mode: create actual Stripe refund
    const stripe = getStripeInstance();
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount, // Amount in paise
      reason: reason,
      metadata: { reason }
    });
    
    console.log('✅ Stripe: Refund created', refund.id);
    return refund;
  } catch (error) {
    console.error('❌ Stripe: Refund failed', error);
    throw new Error(`Stripe refund failed: ${error.message}`);
  }
};

/**
 * Get publishable key for frontend
 * @returns {string|null} Publishable key or mock key
 */
export const getPublishableKey = () => {
  if (useMockMode()) return 'pk_test_mock_publishable_key';
  return process.env.STRIPE_PUBLISHABLE_KEY || null;
};

export default {
  createPaymentIntent,
  retrievePaymentIntent,
  confirmPaymentIntent,
  verifyWebhookSignature,
  cancelPaymentIntent,
  createRefund,
  isConfigured,
  getPublishableKey,
  useMockMode,
};
