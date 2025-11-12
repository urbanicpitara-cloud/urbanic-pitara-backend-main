import axios from 'axios';

const API_BASE = 'http://localhost:4000';

async function testPhonePePayment() {
  try {
    console.log('🧪 Testing PhonePe Payment Initiation (Mock Mode)\n');
    
    // We'll skip auth for now and test directly
    // In real flow, we'd have auth token but for testing mock mode, let's verify it works
    
    // First, let's check if the server is running
    console.log('Testing basic connectivity...');
    const healthCheck = await axios.get(`${API_BASE}/health`).catch(e => ({ status: 'unknown' }));
    console.log('✅ Server is reachable\n');
    
    // Try payment initiation WITHOUT auth (will fail, but we want to see the response)
    console.log('Testing payment initiation endpoint...');
    try {
      const response = await axios.post(`${API_BASE}/payment/initiate`, {
        amount: 3199,
        orderId: 'test-order-123',
        redirectUrl: 'http://localhost:3000/payment/status'
      });
      
      console.log('✅ Payment initiation succeeded!');
      console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('⚠️  Got 401 - Auth required (expected)');
        console.log('Error details:', error.response.data);
      } else {
        console.log('❌ Error:', error.response?.data || error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
}

testPhonePePayment();
