import crypto from 'crypto';

// Test values from .env
const PHONEPE_MERCHANT_ID = 'PGTESTPAYUAT';
const PHONEPE_SALT_KEY = '099eb0cd-02cf-4e2a-8aca-3e6c6aff0399';
const PHONEPE_SALT_INDEX = '1';

// Test payload
const payload = {
  merchantId: PHONEPE_MERCHANT_ID,
  merchantTransactionId: 'TEST_TXN_001',
  amount: 100,
  redirectUrl: 'http://localhost:3000/payment/status',
  redirectMode: 'REDIRECT',
  callbackUrl: 'http://localhost:4000/payment/callback',
  paymentInstrument: {
    type: 'PAY_PAGE'
  }
};

// Generate base64
const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
console.log('Payload:', payload);
console.log('Base64 Payload:', base64Payload);
console.log('');

// Generate checksum
const apiEndpoint = '/pg/v1/pay';
const checksumString = `${base64Payload}${apiEndpoint}${PHONEPE_SALT_KEY}`;
console.log('Checksum String:', checksumString);
console.log('');

const sha256 = crypto.createHash('sha256').update(checksumString).digest('hex');
const xVerify = `${sha256}###${PHONEPE_SALT_INDEX}`;
console.log('SHA256:', sha256);
console.log('X-VERIFY:', xVerify);
console.log('');

// Test the request format
console.log('Request Body:', JSON.stringify({ request: base64Payload }, null, 2));
console.log('Request Headers:', {
  'Content-Type': 'application/json',
  'X-VERIFY': xVerify,
});
