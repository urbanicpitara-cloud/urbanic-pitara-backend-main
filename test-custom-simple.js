#!/usr/bin/env node

// Simple test using native fetch (Node 18+)

const BASE_URL = 'http://localhost:4000';

async function test() {
  try {
    console.log('🧪 Testing Custom Product to Cart Flow...\n');

    // Step 1: Get a cart
    console.log('Step 1: Creating a cart...');
    const cartRes = await fetch(`${BASE_URL}/api/cart`, {
      method: 'GET',
      headers: {
        'Cookie': '', // Will get cartId from response cookies
      },
    });

    let cartId;
    if (cartRes.ok) {
      const cartData = await cartRes.json();
      cartId = cartData.id;
      console.log(`✅ Cart created: ${cartId}\n`);
    } else {
      console.error('Failed to create cart');
      return;
    }

    // Step 2: Create a custom product (if endpoint exists)
    console.log('Step 2: Checking customizer route...');
    try {
      const customRes = await fetch(`${BASE_URL}/api/customizer/templates`, {
        method: 'GET',
      });
      const templates = await customRes.json();
      console.log('✅ Customizer endpoint is working\n');
    } catch (e) {
      console.log('⚠️  Customizer route might not be initialized yet\n');
    }

    // Step 3: Add custom product to cart WITHOUT base product
    console.log('Step 3: Adding custom product to cart (NO base product)...');
    console.log('Payload: { cartId, customProductId, quantity: 1 }');
    
    const addRes = await fetch(`${BASE_URL}/api/cart/lines`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `cartId=${cartId}`,
      },
      body: JSON.stringify({
        cartId,
        customProductId: 'custom-test-123',
        quantity: 1,
      }),
    });

    console.log(`Response status: ${addRes.status}`);
    const responseText = await addRes.text();
    console.log(`Response: ${responseText.substring(0, 200)}...\n`);

    if (addRes.ok) {
      const cartData = JSON.parse(responseText);
      console.log('✅ Successfully added custom product to cart!');
      console.log(JSON.stringify(cartData, null, 2));
    } else {
      console.error('❌ Failed to add custom product');
      console.error(responseText);
    }

  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
}

test();
