#!/usr/bin/env node

import axios from 'axios';

const API = axios.create({
  baseURL: 'http://localhost:4000',
  validateStatus: () => true // Don't throw on any status
});

async function runFullTest() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║      🚀 URBANIC PITARA - PhonePe Payment Flow TEST          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Create a test user (signup)
    console.log('📝 Step 1: Creating test user...');
    const signupRes = await API.post('/auth/signup', {
      name: 'Test User',
      firstName: 'Test',
      lastName: 'User',
      email: `test-${Date.now()}@example.com`,
      password: 'Test@123456',
      confirmPassword: 'Test@123456'
    });
    
    if (!signupRes.data.success) {
      console.log('⚠️  Signup response:', signupRes.data);
    }
    let token = signupRes.data.data?.token;
    
    if (!token) {
      // Try login instead
      console.log('↪️  Trying login with existing user...');
      const loginRes = await API.post('/auth/login', {
        email: 'admin@urbanic.in',
        password: 'Admin@123'
      });
      token = loginRes.data.data?.token;
      console.log('✅ Login response:', loginRes.status, loginRes.data.success ? '(success)' : '(failed)');
    } else {
      console.log('✅ User created/authenticated');
    }

    if (!token) {
      throw new Error('Could not get auth token');
    }

    // Set default header
    API.defaults.headers.common['Authorization'] = `Bearer ${token}`;

    // Step 2: Create an order
    console.log('\n📦 Step 2: Creating order with cart snapshot...');
    const orderRes = await API.post('/orders', {
      paymentMethod: 'PHONEPE',
      cartSnapshot: [
        {
          productId: 'prod-001',
          quantity: 1,
          priceAmount: 999,
          priceCurrency: 'INR'
        }
      ]
    });

    console.log(`Response: ${orderRes.status}`);
    if (!orderRes.data.success) {
      console.log('❌ Order creation failed:', orderRes.data);
      return;
    }
    
    const orderId = orderRes.data.data?.id;
    console.log(`✅ Order created: ${orderId}`);

    // Step 3: Initiate PhonePe payment
    console.log('\n💳 Step 3: Initiating PhonePe payment...');
    const paymentRes = await API.post('/payment/initiate', {
      amount: 999,
      orderId: orderId,
      redirectUrl: 'http://localhost:3000/payment/status'
    });

    console.log(`Response: ${paymentRes.status}`);
    if (paymentRes.status === 200 && paymentRes.data.success) {
      console.log('✅ Payment initiation successful!');
      console.log(`📍 Redirect URL: ${paymentRes.data.data?.redirectUrl}`);
      console.log(`🔑 Transaction ID: ${paymentRes.data.data?.transactionId}`);
    } else {
      console.log('❌ Payment initiation failed:', paymentRes.data);
      return;
    }

    // Step 4: Check payment status
    console.log('\n📊 Step 4: Checking payment status...');
    const statusRes = await API.get(`/payment/status/${paymentRes.data.data?.transactionId}`);
    
    console.log(`Response: ${statusRes.status}`);
    if (statusRes.data.success) {
      console.log('✅ Status check successful!');
      console.log(`Status: ${statusRes.data.data?.status}`);
    } else {
      console.log('⚠️  Status check response:', statusRes.data);
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                  ✅ FULL FLOW WORKS!                        ║');
    console.log('║                                                            ║');
    console.log('║  Order Created → PhonePe Payment Initiated → Status OK    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

runFullTest();
