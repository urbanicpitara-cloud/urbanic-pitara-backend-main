import axios from 'axios';

const API_BASE = 'http://localhost:4000';

async function testPaymentFlow() {
  try {
    console.log('🧪 Testing PhonePe Payment Flow\n');
    
    // Step 1: Login to get auth token
    console.log('Step 1: Logging in...');
    const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
      email: 'test@example.com',
      password: 'Test@123456'
    });
    
    const token = loginResponse.data.data.token;
    console.log('✅ Login successful, token:', token.substring(0, 20) + '...\n');
    
    // Step 2: Create an order
    console.log('Step 2: Creating order...');
    const orderResponse = await axios.post(`${API_BASE}/orders`, {
      paymentMethod: 'PHONEPE',
      cartSnapshot: [
        {
          productId: 'test-product-1',
          quantity: 1,
          priceAmount: 3199,
          priceCurrency: 'INR'
        }
      ]
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const orderId = orderResponse.data.data.id;
    console.log('✅ Order created:', orderId, '\n');
    
    // Step 3: Initiate payment
    console.log('Step 3: Initiating PhonePe payment...');
    const paymentResponse = await axios.post(`${API_BASE}/payment/initiate`, {
      amount: 3199,
      orderId,
      redirectUrl: 'http://localhost:3000/payment/status'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ Payment initiated!');
    console.log('Response:', JSON.stringify(paymentResponse.data, null, 2));
    console.log('\n🎉 Complete flow works!');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

testPaymentFlow();
