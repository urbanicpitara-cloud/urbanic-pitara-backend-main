import axios from 'axios';

const BASE_URL = 'http://localhost:4000';

async function testCustomProductCart() {
  try {
    console.log('🧪 Testing Custom Product to Cart Flow...\n');

    // Step 1: Create a custom product
    console.log('Step 1: Creating a custom product...');
    const customProductRes = await axios.post(`${BASE_URL}/api/customizer/products`, {
      userId: 'test-user-123',
      title: 'Custom Pink Hoodie',
      color: 'pink',
      size: 'M',
      description: 'A custom designed pink hoodie',
      previewUrl: 'https://example.com/preview.png',
      design: {
        // Some design data
        elements: [],
      },
      price: 1500,
    });

    const customProductId = customProductRes.data.id;
    console.log(`✅ Custom product created: ${customProductId}\n`);

    // Step 2: Create a cart
    console.log('Step 2: Getting/creating a cart...');
    const cartRes = await axios.post(`${BASE_URL}/api/cart`, {
      userId: 'test-user-123',
    });

    const cartId = cartRes.data.id;
    console.log(`✅ Cart created/retrieved: ${cartId}\n`);

    // Step 3: Add custom product to cart WITHOUT any base product
    console.log('Step 3: Adding custom product to cart (NO base product)...');
    const addToCartRes = await axios.post(`${BASE_URL}/api/cart/lines`, {
      cartId,
      customProductId, // ONLY customProductId, NO productId
      quantity: 1,
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log('✅ Custom product added to cart successfully!');
    console.log('Cart after adding custom product:', JSON.stringify(addToCartRes.data, null, 2));

    // Step 4: Verify the cart item
    const cartLineItem = addToCartRes.data.lines[0];
    if (!cartLineItem.customProduct) {
      console.error('❌ ERROR: Custom product not found in cart!');
      return false;
    }

    if (cartLineItem.product !== null) {
      console.error('❌ ERROR: Regular product should be null but it is:', cartLineItem.product);
      return false;
    }

    console.log('\n✅ All checks passed!');
    console.log('Custom product can be added to cart independently without a base product!');
    return true;

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    return false;
  }
}

testCustomProductCart();
