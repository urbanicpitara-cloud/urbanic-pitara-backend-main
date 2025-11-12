#!/usr/bin/env node

import axios from 'axios';

const API = 'http://localhost:4000';

async function simpleTest() {
  try {
    console.log('\n✅ Testing backend connectivity...\n');
    
    // Test 1: GET / to see if server responds
    const response = await axios.get(`${API}/`, { maxRedirects: 0 }).catch(e => e.response || e);
    console.log('GET / response:', response?.status || 'No response');
    
    // Test 2: Try a simple endpoint without auth
    console.log('\nTesting payment endpoints...');
    
    // Without auth, should get 401
    const paymentRes = await axios.post(`${API}/payment/initiate`, {
      amount: 100,
      orderId: 'test-order'
    }).catch(e => e.response);
    
    console.log('POST /payment/initiate response status:', paymentRes?.status);
    console.log('Response:', JSON.stringify(paymentRes?.data, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

simpleTest();
