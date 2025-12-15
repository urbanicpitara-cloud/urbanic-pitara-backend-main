import { StandardCheckoutClient, Env, MetaInfo, StandardCheckoutPayRequest } from 'pg-sdk-node';
import axios from 'axios';
import crypto from 'crypto';

const {
  PHONEPE_SALT_KEY,
  PHONEPE_SALT_INDEX,
  PHONEPE_ENV,
  FRONTEND_URL,
  PHONEPE_CLIENT_ID,
  PHONEPE_CLIENT_SECRET,
  PHONEPE_CLIENT_VERSION,
} = process.env;

// Initialize SDK Client
const env = (PHONEPE_ENV === 'PROD' || PHONEPE_ENV === 'production') ? Env.PRODUCTION : Env.SANDBOX;

// Helper to get SDK client
const getClient = () => {
  if (!PHONEPE_CLIENT_ID || !PHONEPE_CLIENT_SECRET) {
    throw new Error('PHONEPE_CLIENT_ID and PHONEPE_CLIENT_SECRET are required');
  }
  return StandardCheckoutClient.getInstance(
    PHONEPE_CLIENT_ID,
    PHONEPE_CLIENT_SECRET,
    parseInt(PHONEPE_CLIENT_VERSION || '1', 10),
    env
  );
};

// Keep token cache for status check manual calls
let tokenCache = {
  accessToken: null,
  tokenType: null,
  expiresAt: 0,
};

/**
 * Fetch OAuth token manually (for status checks if needed outside SDK)
 */
export const fetchAuthToken = async () => {
    // Re-use SDK logic? No, SDK handles it internally for payments. 
    // We keep this for our manual status check if we don't use SDK for status.
    // ... (Keep existing implementation simplified or rely on SDK?)
    // Actually, let's keep it as is, it works for status checks.
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.accessToken && tokenCache.expiresAt - 60 > now) {
    return tokenCache;
  }
  // If we are using SDK for initiation, we might not need this for initiation, 
  // but status check implementation below uses it.
  
  // Reuse existing logic
  const tokenUrl = (PHONEPE_ENV === 'PROD' || PHONEPE_ENV === 'production')
      ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token';

  const body = new URLSearchParams();
  body.append('client_id', PHONEPE_CLIENT_ID);
  body.append('client_secret', PHONEPE_CLIENT_SECRET);
  body.append('client_version', PHONEPE_CLIENT_VERSION || '1');
  body.append('grant_type', 'client_credentials');

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const resp = await axios.post(tokenUrl, body.toString(), { headers });
  const data = resp.data || {};
  tokenCache = {
    accessToken: data.access_token,
    tokenType: data.token_type || 'O-Bearer',
    expiresAt: data.expires_at ? Number(data.expires_at) : (Math.floor(Date.now() / 1000) + 3600),
  };
  return tokenCache;
};

/**
 * Initiate payment using PhonePe Node SDK
 */
export const initiatePayment = async ({
  amount, // in rupees
  merchantTransactionId,
  callbackUrl,
  redirectUrl,
  userId, // Optional user ID for context
}) => {
  try {
    /* 
    // Check if we're in development mode with mock enabled
    const useMockPhonePe = process.env.PHONEPE_MOCK === 'true';

    if (useMockPhonePe) {
        console.log('📌 Using MOCK PhonePe (Development Mode)');
        return {
          success: true,
          data: {
            redirectUrl: `${FRONTEND_URL}/payment/status?merchantTransactionId=${merchantTransactionId}`, // Direct mock success
            // In mock mode, we simulate the redirect to status page
          }
        };
    }
    */

    const client = getClient();
    
    // SDK expects amount in PAISA (Long)
    // Input `amount` is in Rupees from our payment service? 
    // Let's check: src/routes/payment.js calls with `amount` (which is order.totalAmount).
    // Wait, in src/routes/payment.js: `const amount = Math.round(order.totalAmount * 100);` ??
    // No, earlier snippet showed `const amount = parseFloat(orderData.totalAmount ...)` in Frontend.
    // In Backend `payment.js`: `const { amount } = req.body;`.
    // The frontend sends `amount` as float/number. 
    // Wait, let's verify if `payment.js` receives Rupees or Paisa.
    // Frontend `paymentRepository.initiate({ amount ... })`.
    // If backend `payment.js` receives Rupees, then we need to multiply by 100.
    // If backend already receives Paisa, we don't.
    // Looking at `generatePayload` in previous file: `amount: amount * 100`. 
    // This implies the input `amount` to `initiatePayment` was in RUPEES.
    // So for SDK: `amount: amount * 100`.
    
    const amountInPaisa = Math.round(amount * 100);

    const requestBuilder = StandardCheckoutPayRequest.builder()
        .merchantOrderId(merchantTransactionId) // Maps to merchantTransactionId
        .amount(amountInPaisa)
        .redirectUrl(redirectUrl || `${FRONTEND_URL}/payment/status`);

    // Optional: Add user ID or mobile if available
    // if (userId) requestBuilder.merchantUserId(userId); 
    
    const request = requestBuilder.build();

    console.log('🚀 Initiating PhonePe Payment (SDK):', { merchantTransactionId, amountInPaisa });
    
    const response = await client.pay(request);
    
    // SDK returns a StandardCheckoutPayResponse
    // It has `redirectUrl` property
    const checkoutUrl = response.redirectUrl;

    return {
      success: true,
      data: {
        redirectUrl: checkoutUrl,
        transactionId: response.merchantOrderId || merchantTransactionId, // Ensure we return ID
      }
    };

  } catch (error) {
    console.error('PhonePe SDK Init Error:', error);
    // Return structured error
    return {
      success: false,
      error: error.message || 'Payment initiation failed',
    };
  }
};

/**
 * Generate X-VERIFY manually (for status check usage compatibility)
 */
export const generateXVerify = (base64Payload, apiEndpoint) => {
  const string = `${base64Payload}${apiEndpoint}${PHONEPE_SALT_KEY}`;
  const sha256 = crypto.createHash('sha256').update(string).digest('hex');
  return `${sha256}###${PHONEPE_SALT_INDEX}`;
};

/**
 * Check payment status
 * Note: SDK might have checkStatus, but manual implementation is reliable for now.
 */
export const checkPaymentStatus = async (merchantTransactionId) => {
  try {
     const useMockPhonePe = process.env.PHONEPE_MOCK === 'true';
     if (useMockPhonePe) {
        return {
            success: true,
            code: 'PAYMENT_SUCCESS',
            data: { state: 'COMPLETED', transactionId: merchantTransactionId }
        };
     }

    const client = getClient();
    
    console.log('🚀 Checking Payment Status (SDK):', merchantTransactionId);
    
    // SDK handles authentication (Client ID/Secret) automatically
    // It should use the correct endpoint and headers.
    // getStatus or getTransactionStatus usually takes the transaction ID.
    // Inspect of SDK showed getTransactionStatus and getOrderStatus.
    // We try getStatus first (common alias) or getTransactionStatus.
    
    const response = await client.getTransactionStatus(merchantTransactionId);
    console.log('🚀 SDK Status Response:', JSON.stringify(response, null, 2));
    
    // Normalize response: The SDK might return the `data` object directly or the full API response.
    // payment.js expects `response.data.state`.
    if (response && response.state && !response.data) {
        // SDK returned the inner data object directly
        return {
            success: true,
            code: response.responseCode || 'PAYMENT_SUCCESS',
            data: response
        };
    }
    
    return response;

  } catch (error) {
    console.error('PhonePe SDK Status Check Error:', error.message);
    // Fallback to manual if SDK method name is wrong? 
    // But better to trust SDK than broken manual key.
    throw error;
  }
};

/**
 * Verify Callback
 */
export const verifyCallback = (payload, xVerify) => {
  // Use generateXVerify match
  const calculated = generateXVerify(payload, '');
  return calculated === xVerify;
};