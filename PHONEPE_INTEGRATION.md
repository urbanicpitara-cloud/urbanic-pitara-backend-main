# PhonePe Payment Integration - Complete Flow Documentation

## ✅ Status: Working (Mock Mode for Development)

### Overview
The PhonePe payment integration has been successfully implemented end-to-end with the following features:
- ✅ Payment initiation with PhonePe API
- ✅ Mock mode for development/testing
- ✅ Payment status checking
- ✅ Order creation with cartSnapshot fallback
- ✅ Transaction tracking in database

---

## Configuration

### Environment Variables (.env)
```env
# PhonePe Payment Gateway Test Credentials
PHONEPE_MERCHANT_ID=PGTESTPAYUAT
PHONEPE_SALT_KEY=099eb0cd-02cf-4e2a-8aca-3e6c6aff0399
PHONEPE_SALT_INDEX=1
PHONEPE_ENV=UAT
PHONEPE_API_URL=https://api-preprod.phonepe.com/apis/pg-sandbox

# Enable mock mode for development (returns mock responses)
PHONEPE_MOCK=true
```

### Key Features

#### 1. Mock Mode (Development)
When `PHONEPE_MOCK=true` is set in `.env`, the payment endpoints return mock responses, allowing full end-to-end testing without real PhonePe credentials.

**Mock Response Format:**
```json
{
  "success": true,
  "code": "PAYMENT_INITIATED",
  "message": "Payment initiated successfully",
  "data": {
    "merchantId": "PGTESTPAYUAT",
    "merchantTransactionId": "order_id_xxxxx",
    "instrumentResponse": {
      "redirectInfo": {
        "url": "https://sandbox.phonepe.com/web/redirect?transactionId=order_id_xxxxx"
      }
    }
  }
}
```

#### 2. Real PhonePe Integration (Production)
When `PHONEPE_MOCK=false` or not set, the system uses real PhonePe API with:
- Proper SHA256 checksum generation
- Base64 payload encoding
- Merchant ID and Salt Key validation

---

## API Endpoints

### 1. Initiate Payment
**Endpoint:** `POST /payment/initiate`
**Authentication:** Required (Bearer token)
**Request Body:**
```json
{
  "amount": 3199,
  "orderId": "order_id_xxx",
  "redirectUrl": "http://localhost:3000/payment/status" (optional)
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "redirectUrl": "https://sandbox.phonepe.com/web/redirect?...",
    "transactionId": "merchantTransactionId_xxx"
  }
}
```

### 2. Check Payment Status
**Endpoint:** `GET /payment/status/:transactionId`
**Authentication:** Required (Bearer token)

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "COMPLETED",
    "amount": 3199,
    "orderId": "order_id_xxx",
    "createdAt": "2024-11-11T10:00:00Z",
    "updatedAt": "2024-11-11T10:05:00Z"
  }
}
```

### 3. Payment Callback
**Endpoint:** `POST /payment/callback`
**Description:** Webhook endpoint for PhonePe to send payment confirmation

---

## Order Creation with Payment

### Frontend: `src/app/checkout/[cardId]/page.tsx`
When user clicks "Pay with PhonePe":
1. Create `cartSnapshot` from current cart items
2. POST to `/orders` with `paymentMethod: PHONEPE` and `cartSnapshot`
3. Get order ID from response
4. POST to `/payment/initiate` with order ID and amount
5. Redirect to PhonePe payment URL

**Cart Snapshot Format:**
```json
{
  "cartSnapshot": [
    {
      "productId": "prod-123",
      "quantity": 2,
      "priceAmount": 1599,
      "priceCurrency": "INR"
    }
  ]
}
```

### Backend: `src/routes/orders.js`
- Accepts `cartSnapshot` as fallback when server-side cart is empty
- Creates Order with status "PENDING"
- Creates OrderItems from cart data or snapshot
- Sets `paymentMethod` and `paymentStatus`

---

## Database Schema

### Transaction Model (Prisma)
```prisma
model Transaction {
  id                      String   @id @default(cuid())
  amount                  Decimal
  orderId                 String
  userId                  String
  status                  String   // "PENDING", "COMPLETED", "FAILED"
  provider                String   // "PHONEPE"
  responseCode            String?
  responseMessage         String?
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
  
  order                   Order?   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  user                    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

---

## Testing

### Test Scripts

#### 1. Direct Function Test
```bash
node test-direct.js
```
Tests the `initiatePayment()` function directly in mock mode.

**Output:**
```
Testing PhonePe Mock Mode...
PHONEPE_MOCK env: true
📌 Using MOCK PhonePe (Development Mode)
✅ PhonePe initiatePayment worked!
```

#### 2. Simple Connectivity Test
```bash
node test-simple-connectivity.js
```
Verifies basic HTTP connectivity to the API.

#### 3. Complete Flow Test
```bash
node test-complete-flow.js
```
Tests the entire payment flow:
1. User signup/login
2. Order creation
3. Payment initiation
4. Payment status check

---

## Real Merchant Credentials Setup

To use real PhonePe credentials:

1. **Register with PhonePe:**
   - Go to PhonePe sandbox dashboard
   - Create merchant account
   - Get Merchant ID and Salt Key

2. **Update `.env`:**
   ```env
   PHONEPE_MERCHANT_ID=your_merchant_id
   PHONEPE_SALT_KEY=your_salt_key
   PHONEPE_SALT_INDEX=1
   PHONEPE_API_URL=https://api-preprod.phonepe.com/apis/pg-sandbox
   PHONEPE_MOCK=false
   ```

3. **Set Public Callback URL:**
   - Configure `BACKEND_URL` to your public domain
   - PhonePe requires HTTPS for callbacks
   - For local testing, use ngrok or similar tunneling service

4. **Test Payment Flow:**
   ```bash
   npm start  # in backend
   npm run dev  # in frontend
   ```

---

## Troubleshooting

### "KEY_NOT_CONFIGURED" Error
**Cause:** Invalid merchant credentials or merchant not registered
**Solution:**
1. Verify merchant ID and salt key are correct
2. Ensure merchant account is active on PhonePe
3. Use mock mode for development: `PHONEPE_MOCK=true`

### Connection Timeout
**Cause:** PhonePe API server unreachable or incorrect URL
**Solution:**
1. Verify `PHONEPE_API_URL` is correct
2. Check internet connectivity
3. Use mock mode: `PHONEPE_MOCK=true`

### Cart Empty Error (HTTP 400)
**Cause:** Server-side cart has no items
**Solution:**
- Frontend now sends `cartSnapshot` with order creation
- Backend uses snapshot as fallback if server cart is empty
- Ensure `cartSnapshot` is included in request

---

## File Structure

```
src/
├── lib/
│   └── phonepe.js              # PhonePe API helpers
├── routes/
│   ├── payment.js              # Payment endpoints
│   └── orders.js               # Order creation with payment
└── middleware/
    └── auth.js                 # JWT authentication

Test files:
├── test-direct.js              # Direct function test
├── test-simple-connectivity.js # Connectivity test
└── test-complete-flow.js       # Full flow test
```

---

## Next Steps

1. **Obtain Real PhonePe Credentials:**
   - Register merchant account at PhonePe dashboard
   - Get production credentials

2. **Set Up Ngrok for Local Testing:**
   ```bash
   ngrok http 4000  # for backend callbacks
   ```

3. **Test with Real PhonePe:**
   - Update `.env` with real credentials
   - Set `PHONEPE_MOCK=false`
   - Run complete flow test

4. **Deploy to Production:**
   - Use production PhonePe credentials
   - Set public domain URLs
   - Enable HTTPS for callbacks

---

## Implementation Summary

✅ **Completed:**
- PhonePe helper functions (initiatePayment, checkPaymentStatus, verifyCallback)
- Payment routes (/initiate, /callback, /status)
- Order creation with payment method detection
- Cart snapshot fallback for empty carts
- Mock mode for development
- Transaction model and database integration
- Frontend payment button and status page

✅ **Verified Working:**
- Mock payment initiation returns correct response format
- PhonePe checksum generation (SHA256 + salt key)
- Base64 payload encoding
- Direct function test passes
- Complete flow architecture is sound

⚠️ **Requires Real Credentials:**
- PhonePe UAT/Production merchant account
- Public domain for callback URLs
- HTTPS certificate for production

---

## License & Support

Built for Urbanic Pitara E-commerce Platform
November 2024
