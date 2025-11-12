import dotenv from 'dotenv';
dotenv.config();

import { initiatePayment } from './src/lib/phonepe.js';

console.log('Testing PhonePe Mock Mode...');
console.log('PHONEPE_MOCK env:', process.env.PHONEPE_MOCK);
console.log('NODE_ENV:', process.env.NODE_ENV);

const testInitiate = async () => {
  try {
    const result = await initiatePayment({
      amount: 100,
      merchantTransactionId: 'TEST_123_456',
      callbackUrl: 'http://localhost:4000/payment/callback',
      redirectUrl: 'http://localhost:3000/payment/status'
    });
    
    console.log('\n✅ PhonePe initiatePayment worked!');
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response?.data) {
      console.error('Response data:', error.response.data);
    }
  }
};

testInitiate();
