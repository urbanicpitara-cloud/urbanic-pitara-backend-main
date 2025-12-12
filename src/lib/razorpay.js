import Razorpay from 'razorpay';
import crypto from 'crypto';

const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
  NODE_ENV,
} = process.env;

/**
 * Check if we should use mock mode
 * Mock mode is enabled when:
 * 1. RAZORPAY_MOCK=true is set, OR
 * 2. No credentials are provided (development)
 */
const useMockMode = () => {
  if (process.env.RAZORPAY_MOCK === 'true') return true;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) return true;
  return false;
};

/**
 * Initialize Razorpay instance
 */
const getRazorpayInstance = () => {
  if (useMockMode()) {
    console.log('📌 Razorpay: Using MOCK mode (no credentials)');
    return null;
  }

  // Debug: Log key status (first few characters only)
  console.log('🔑 Razorpay: Initializing with credentials');
  console.log('   Key ID:', RAZORPAY_KEY_ID ? `${RAZORPAY_KEY_ID.substring(0, 12)}...` : 'MISSING');
  console.log('   Key Secret:', RAZORPAY_KEY_SECRET ? `${RAZORPAY_KEY_SECRET.substring(0, 4)}...` : 'MISSING');

  return new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
  });
};

/**
 * Create Razorpay order
 * @param {Object} params - Order parameters
 * @param {number} params.amount - Amount in rupees
 * @param {string} params.orderId - Your order ID
 * @param {string} params.currency - Currency code (default: INR)
 * @returns {Promise<Object>} Razorpay order
 */
export const createOrder = async ({ amount, orderId, currency = 'INR' }) => {
  try {
    // Mock mode: return fake order
    if (useMockMode()) {
      console.log('📌 Razorpay Mock: Creating order', { amount, orderId });
      return {
        id: `order_mock_${Date.now()}`,
        entity: 'order',
        amount: amount * 100, // Convert to paisa
        amount_paid: 0,
        amount_due: amount * 100,
        currency,
        receipt: orderId,
        status: 'created',
        notes: {},
      };
    }

    // Real mode: create actual Razorpay order
    const razorpay = getRazorpayInstance();
    const options = {
      amount: amount * 100, // Convert to paisa
      currency,
      receipt: orderId,
      notes: {
        orderId,
      },
    };

    const order = await razorpay.orders.create(options);
    console.log('✅ Razorpay: Order created', order.id);
    return order;
  } catch (error) {
    console.error('❌ Razorpay: Order creation failed', error);
    throw error;
  }
};

/**
 * Verify Razorpay payment signature
 * @param {Object} params - Verification parameters
 * @param {string} params.razorpayOrderId - Razorpay order ID
 * @param {string} params.razorpayPaymentId - Razorpay payment ID
 * @param {string} params.razorpaySignature - Razorpay signature
 * @returns {boolean} True if signature is valid
 */
export const verifyPaymentSignature = ({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) => {
  try {
    // Mock mode: always return true
    if (useMockMode()) {
      console.log('📌 Razorpay Mock: Signature verification (auto-pass)');
      return true;
    }

    // Real mode: verify signature
    const text = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(text)
      .digest('hex');

    const isValid = expectedSignature === razorpaySignature;
    console.log(isValid ? '✅ Razorpay: Signature valid' : '❌ Razorpay: Signature invalid');
    return isValid;
  } catch (error) {
    console.error('❌ Razorpay: Signature verification failed', error);
    return false;
  }
};

/**
 * Verify webhook signature
 * @param {string} webhookBody - Raw webhook body
 * @param {string} webhookSignature - X-Razorpay-Signature header
 * @returns {boolean} True if webhook is valid
 */
export const verifyWebhookSignature = (webhookBody, webhookSignature) => {
  try {
    // Mock mode: always return true
    if (useMockMode()) {
      console.log('📌 Razorpay Mock: Webhook verification (auto-pass)');
      return true;
    }

    if (!RAZORPAY_WEBHOOK_SECRET) {
      console.warn('⚠️ Razorpay: No webhook secret configured');
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex');

    const isValid = expectedSignature === webhookSignature;
    console.log(isValid ? '✅ Razorpay: Webhook valid' : '❌ Razorpay: Webhook invalid');
    return isValid;
  } catch (error) {
    console.error('❌ Razorpay: Webhook verification failed', error);
    return false;
  }
};

/**
 * Fetch payment details
 * @param {string} paymentId - Razorpay payment ID
 * @returns {Promise<Object>} Payment details
 */
export const fetchPayment = async (paymentId) => {
  try {
    // Mock mode: return fake payment
    if (useMockMode()) {
      console.log('📌 Razorpay Mock: Fetching payment', paymentId);
      return {
        id: paymentId,
        entity: 'payment',
        amount: 100000, // ₹1000
        currency: 'INR',
        status: 'captured',
        method: 'card',
        captured: true,
        email: 'test@example.com',
        contact: '+919999999999',
      };
    }

    // Real mode: fetch actual payment
    const razorpay = getRazorpayInstance();
    const payment = await razorpay.payments.fetch(paymentId);
    console.log('✅ Razorpay: Payment fetched', payment.id);
    return payment;
  } catch (error) {
    console.error('❌ Razorpay: Payment fetch failed', error);
    throw error;
  }
};

/**
 * Check if Razorpay is configured
 * @returns {boolean} True if configured (has credentials or mock mode)
 */
export const isConfigured = () => {
  return useMockMode() || (!!RAZORPAY_KEY_ID && !!RAZORPAY_KEY_SECRET);
};

/**
 * Initiate a refund for a Razorpay payment
 * @param {string} paymentId - Razorpay payment ID (pay_xxx)
 * @param {number} amount - Amount to refund in paise (smallest currency unit)
 * @param {string} reason - Reason for refund
 * @returns {Promise<Object>} Refund object
 */
export const createRefund = async (paymentId, amount, reason = 'requested_by_customer') => {
  try {
    // Mock mode: simulate refund
    if (useMockMode()) {
      console.log('📌 Razorpay Mock: Simulating refund', { paymentId, amount, reason });
      return {
        id: `rfnd_mock_${Date.now()}`,
        entity: 'refund',
        payment_id: paymentId,
        amount: amount,
        currency: 'INR',
        status: 'processed',
        speed_requested: 'normal',
        speed_processed: 'normal',
        created_at: Math.floor(Date.now() / 1000),
        notes: { reason }
      };
    }

    // Real mode: create actual Razorpay refund
    const razorpay = getRazorpayInstance();
    const refund = await razorpay.payments.refund(paymentId, {
      amount: amount, // Amount in paise
      speed: 'normal',
      notes: { reason }
    });
    
    console.log('✅ Razorpay: Refund created', refund.id);
    return refund;
  } catch (error) {
    console.error('❌ Razorpay: Refund failed', error);
    throw new Error(`Razorpay refund failed: ${error.error?.description || error.message}`);
  }
};

/**
 * Get Razorpay key ID for frontend
 * @returns {string|null} Key ID or null if mock mode
 */
export const getKeyId = () => {
  if (useMockMode()) return 'rzp_test_mock_key_id';
  return RAZORPAY_KEY_ID;
};

export default {
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  fetchPayment,
  createRefund,
  isConfigured,
  getKeyId,
  useMockMode,
};
