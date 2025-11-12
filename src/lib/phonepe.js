import crypto from 'crypto';
import axios from 'axios';

const {
  PHONEPE_MERCHANT_ID,
  PHONEPE_SALT_KEY,
  PHONEPE_SALT_INDEX,
  PHONEPE_API_URL,
  PHONEPE_ENV,
  FRONTEND_URL,
  // Client credentials for OAuth token
  PHONEPE_CLIENT_ID,
  PHONEPE_CLIENT_SECRET,
  PHONEPE_CLIENT_VERSION,
  // Optional override for token endpoint
  PHONEPE_TOKEN_URL,
} = process.env;

// Simple in-memory token cache
let tokenCache = {
  accessToken: null,
  tokenType: null,
  expiresAt: 0, // epoch seconds
};

/**
 * Fetch OAuth token from PhonePe and cache it until expiry.
 */
export const fetchAuthToken = async () => {
  // If cached and not expired (with 60s buffer), return cached
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.accessToken && tokenCache.expiresAt - 60 > now) {
    return tokenCache;
  }

  // Ensure credentials are present
  if (!PHONEPE_CLIENT_ID || !PHONEPE_CLIENT_SECRET) {
    throw new Error('PHONEPE client credentials are not configured in environment');
  }

  const tokenUrl = PHONEPE_TOKEN_URL
    || (PHONEPE_ENV === 'PROD' || PHONEPE_ENV === 'production'
      ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token');

  const body = new URLSearchParams();
  body.append('client_id', PHONEPE_CLIENT_ID);
  body.append('client_secret', PHONEPE_CLIENT_SECRET);
  body.append('client_version', PHONEPE_CLIENT_VERSION || '1');
  body.append('grant_type', 'client_credentials');

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const resp = await axios.post(tokenUrl, body.toString(), { headers });
  const data = resp.data || {};

  const accessToken = data.access_token;
  const tokenType = data.token_type || 'O-Bearer';
  const expiresAt = data.expires_at ? Number(data.expires_at) : (Math.floor(Date.now() / 1000) + 3600);

  tokenCache = {
    accessToken,
    tokenType,
    expiresAt,
  };

  return tokenCache;
};

/**
 * Generate Base64 encoded payload for PhonePe
 */
export const generatePayload = ({
  amount,
  merchantTransactionId,
  callbackUrl,
  redirectUrl,
}) => {
  const payload = {
    merchantId: PHONEPE_MERCHANT_ID,
    merchantTransactionId,
    amount: amount * 100, // Convert to paisa
    redirectUrl: redirectUrl || `${FRONTEND_URL}/payment/status`,
    redirectMode: 'REDIRECT',
    callbackUrl: callbackUrl || `${FRONTEND_URL}/api/payment/callback`,
    paymentInstrument: {
      type: 'PAY_PAGE'
    }
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
};

/**
 * Generate X-VERIFY header for PhonePe API requests
 */
export const generateXVerify = (base64Payload, apiEndpoint) => {
  const string = `${base64Payload}${apiEndpoint}${PHONEPE_SALT_KEY}`;
  const sha256 = crypto.createHash('sha256').update(string).digest('hex');
  return `${sha256}###${PHONEPE_SALT_INDEX}`;
};

/**
 * Initiate payment with PhonePe
 */
export const initiatePayment = async ({
  amount,
  merchantTransactionId,
  callbackUrl,
  redirectUrl,
}) => {
  try {
    // Check if we're in development mode with mock enabled
    const useMockPhonePe = process.env.PHONEPE_MOCK === 'true' || process.env.NODE_ENV === 'development';
    
    if (useMockPhonePe) {
      console.log('📌 Using MOCK PhonePe (Development Mode)');
      // Return mock successful response
      return {
        success: true,
        code: 'PAYMENT_INITIATED',
        message: 'Payment initiated successfully',
        data: {
          merchantId: PHONEPE_MERCHANT_ID,
          merchantTransactionId,
          instrumentResponse: {
            redirectInfo: {
              url: `https://sandbox.phonepe.com/web/redirect?transactionId=${merchantTransactionId}`
            }
          }
        }
      };
    }

    const apiEndpoint = '/pg/v1/pay';
    const base64Payload = generatePayload({
      amount,
      merchantTransactionId,
      callbackUrl,
      redirectUrl,
    });

    const xVerify = generateXVerify(base64Payload, apiEndpoint);
    
    // Debug logging
    const decodedPayload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
    console.log('PhonePe Debug - Merchant ID:', PHONEPE_MERCHANT_ID);
    console.log('PhonePe Debug - Decoded Payload:', decodedPayload);
    console.log('PhonePe Debug - Base64 Payload:', base64Payload);
    console.log('PhonePe Debug - X-VERIFY Header:', xVerify);
    console.log('PhonePe Debug - API URL:', `${PHONEPE_API_URL}${apiEndpoint}`);
    
    // Prepare headers (include auth token if available)
    const headers = {
      'Content-Type': 'application/json',
      'X-VERIFY': xVerify,
    };

    if (!(process.env.PHONEPE_MOCK === 'true' || process.env.NODE_ENV === 'development')) {
      try {
        const { accessToken, tokenType } = await fetchAuthToken();
        if (accessToken) {
          headers['Authorization'] = `${tokenType} ${accessToken}`;
        }
      } catch (err) {
        // Log token fetch error but continue (server will show PhonePe API error if auth missing)
        console.warn('PhonePe token fetch failed:', err.message || err);
      }
    }

    const response = await axios.post(
      `${PHONEPE_API_URL}${apiEndpoint}`,
      {
        request: base64Payload,
      },
      {
        headers,
      }
    );

    return response.data;
  } catch (error) {
    console.error('PhonePe payment initiation error:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Check payment status with PhonePe
 */
export const checkPaymentStatus = async (merchantTransactionId) => {
  try {
    // Check if we're in development mode with mock enabled
    const useMockPhonePe = process.env.PHONEPE_MOCK === 'true' || process.env.NODE_ENV === 'development';
    
    if (useMockPhonePe) {
      console.log('📌 Using MOCK PhonePe Status Check (Development Mode)');
      // Return mock successful payment status
      return {
        success: true,
        code: 'PAYMENT_SUCCESS',
        message: 'Payment was successful',
        data: {
          state: 'COMPLETED',
          status: 'SUCCESS',
          amount: 100,
          transactionId: merchantTransactionId
        }
      };
    }

    const apiEndpoint = `/pg/v1/status/${PHONEPE_MERCHANT_ID}/${merchantTransactionId}`;
    const xVerify = generateXVerify('', apiEndpoint);

    const headers = {
      'Content-Type': 'application/json',
      'X-VERIFY': xVerify,
      'X-MERCHANT-ID': PHONEPE_MERCHANT_ID,
    };

    // Attach auth token for status check if available
    try {
      const { accessToken, tokenType } = await fetchAuthToken();
      if (accessToken) headers['Authorization'] = `${tokenType} ${accessToken}`;
    } catch (err) {
      // don't block on token fetch; allow request to proceed and let PhonePe respond
      console.warn('PhonePe token fetch failed (status):', err.message || err);
    }

    const response = await axios.get(`${PHONEPE_API_URL}${apiEndpoint}`, { headers });

    return response.data;
  } catch (error) {
    console.error('PhonePe status check error:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Verify PhonePe callback signature
 */
export const verifyCallback = (payload, xVerify) => {
  const calculatedXVerify = generateXVerify(payload, '');
  return calculatedXVerify === xVerify;
};