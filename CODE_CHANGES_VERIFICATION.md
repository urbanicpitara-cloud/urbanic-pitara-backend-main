# 🔍 CODE CHANGE VERIFICATION

## File 1: `/src/routes/orders.js`

### Change 1: Discount Usage Limit Check (Lines ~240-260)
**Location:** Inside POST / endpoint, before creating order

```javascript
// ✅ CHECK USAGE LIMIT
if (discount.usageLimit !== null) {
  const usedCount = await prisma.order.count({
    where: { appliedDiscountId: discount.id },
  });
  
  if (usedCount >= discount.usageLimit) {
    return res.status(400).json({ 
      error: "Discount code usage limit has been reached" 
    });
  }
}
```

**What it does:**
- If discount has a usage limit (not null)
- Count how many orders already used this discount
- If count >= limit, reject with 400 error
- Otherwise continue with order creation

---

### Change 2: Inventory Decrement on Order Creation (Lines ~310-360)
**Location:** Inside POST / endpoint, inside transaction, after creating order

```javascript
// ✅ DECREMENT PRODUCT QUANTITIES FOR EACH ORDER ITEM
for (const item of cartLinesSource) {
  if (item.variantId) {
    // If variant exists, decrement variant quantity
    await tx.productVariant.update({
      where: { id: item.variantId },
      data: {
        inventoryQuantity: {
          decrement: item.quantity,
        },
      },
    });
  } else {
    // If no variant, find the first variant of the product and decrement
    const variant = await tx.productVariant.findFirst({
      where: { productId: item.productId },
    });
    if (variant) {
      await tx.productVariant.update({
        where: { id: variant.id },
        data: {
          inventoryQuantity: {
            decrement: item.quantity,
          },
        },
      });
    }
  }
}
```

**What it does:**
- For each item in the order
- If item has a variant ID → decrement that variant's inventory
- If no variant ID → find first variant and decrement it
- Decrements by the exact quantity ordered
- All happens inside transaction (atomic operation)

---

### Change 3: Inventory Restore on Order Cancellation (Lines ~430-475)
**Location:** Inside POST /:id/cancel endpoint, inside transaction

```javascript
// ✅ RESTORE PRODUCT QUANTITIES IN TRANSACTION
const updatedOrder = await prisma.$transaction(async (tx) => {
  // Restore inventory for each order item
  for (const item of order.items) {
    if (item.variantId) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: {
          inventoryQuantity: {
            increment: item.quantity,
          },
        },
      });
    } else {
      // Find variant by product and restore
      const variant = await tx.productVariant.findFirst({
        where: { productId: item.productId },
      });
      if (variant) {
        await tx.productVariant.update({
          where: { id: variant.id },
          data: {
            inventoryQuantity: {
              increment: item.quantity,
            },
          },
        });
      }
    }
  }

  // Update order status to CANCELED
  return await tx.order.update({
    where: { id },
    data: { status: "CANCELED", cancelReason: reason || "Canceled by customer" },
    include: {
      items: { include: { product: true, variant: true } },
      shippingAddress: true,
      billingAddress: true,
    },
  });
});
```

**What it does:**
- When order is cancelled
- For each item → increment (restore) its variant inventory
- Then update order status to CANCELED
- All happens inside transaction (atomic)

---

## File 2: `/src/routes/discount.js`

### Change 1: Validate Endpoint - Check Usage Limit (Lines ~30-45)
**Location:** Inside POST /validate endpoint

```javascript
// ✅ CHECK USAGE LIMIT
if (discount.usageLimit !== null) {
  const usedCount = await prisma.order.count({
    where: { appliedDiscountId: discount.id },
  });
  
  if (usedCount >= discount.usageLimit) {
    return res.status(400).json({ 
      error: "Discount code usage limit has been reached" 
    });
  }
}
```

**What it does:**
- Frontend calls this to validate discount before checkout
- Checks if discount has hit its usage limit
- Returns error if limit reached
- Also returns usageLimit info in response

---

### Change 2: Create Endpoint - Accept usageLimit (Lines ~76-95)
**Location:** Inside POST /create endpoint

```javascript
const { code, description, type, value, minOrderAmount, startsAt, endsAt, usageLimit, active } = req.body;

const discount = await prisma.discount.create({
  data: {
    code: code.trim().toUpperCase(),
    description,
    type,
    value,
    minOrderAmount,
    startsAt: startsAt ? new Date(startsAt) : null,
    endsAt: endsAt ? new Date(endsAt) : null,
    usageLimit: usageLimit ? parseInt(usageLimit) : null,  // ✅ NEW
    active: active !== undefined ? active : true,          // ✅ NEW
  },
});
```

**What it does:**
- Admin creates new discount
- Can now specify usageLimit parameter
- If provided → converts to int and saves
- If not provided → null (unlimited)

---

### Change 3: Update Endpoint - Accept usageLimit (Lines ~160-178)
**Location:** Inside PATCH /:id endpoint

```javascript
const { description, active, value, type, minOrderAmount, startsAt, endsAt, usageLimit } = req.body;

const updated = await prisma.discount.update({
  where: { id },
  data: {
    description,
    active,
    value,
    type,
    minOrderAmount,
    startsAt: startsAt ? new Date(startsAt) : null,
    endsAt: endsAt ? new Date(endsAt) : null,
    usageLimit: usageLimit !== undefined ? (usageLimit ? parseInt(usageLimit) : null) : undefined,  // ✅ NEW
  },
});
```

**What it does:**
- Admin can update existing discount
- Can modify usageLimit
- If provided → converts to int
- If provided as 0 → null (unlimited)
- If not in request → undefined (don't change)

---

## 🔄 Data Flow Diagrams

### Order Creation Flow (with inventory)
```
1. User clicks "Place Order"
   ↓
2. POST /orders with cartId + discountCode
   ↓
3. Backend: Fetch cart from DB
   ↓
4. Backend: Validate discount code
   ↓
5. Backend: Check discount usage limit
   └─→ If limit reached: Return 400 error ❌
   └─→ If under limit: Continue ✅
   ↓
6. START TRANSACTION
   ├─ Create order in DB
   ├─ Create order items in DB
   ├─ Decrement ProductVariant.inventoryQuantity ← NEW ✅
   ├─ Clear cart lines
   ├─ Create payment record
   └─ COMMIT TRANSACTION
   ↓
7. Return order details + payment info
   ↓
8. Frontend: Show success message
```

### Order Cancellation Flow (with inventory restore)
```
1. User clicks "Cancel Order"
   ↓
2. POST /orders/:id/cancel
   ↓
3. Backend: Fetch order with items
   ↓
4. START TRANSACTION
   ├─ For each order item:
   │  └─ Increment ProductVariant.inventoryQuantity ← NEW ✅
   ├─ Update Order.status = CANCELED
   └─ COMMIT TRANSACTION
   ↓
5. Return cancelled order details
   ↓
6. Frontend: Show "Order cancelled"
```

### Discount Validation Flow (with limit check)
```
1. User enters discount code in checkout
   ↓
2. Frontend: POST /discount/validate
   ↓
3. Backend: Find discount by code
   ↓
4. Backend: Check discount.usageLimit ← NEW ✅
   └─→ Count orders with appliedDiscountId = discount.id
   └─→ If count >= limit: Return error ❌
   └─→ If under limit: Return discount details ✅
   ↓
5. Frontend: Show discount amount (if valid)
```

---

## 🧪 Testing Checklist

- [ ] Create order with inventory tracking
  - [ ] Verify ProductVariant.inventoryQuantity decreased
  - [ ] Works with variants
  - [ ] Works without variants
  
- [ ] Cancel order and check inventory
  - [ ] Verify ProductVariant.inventoryQuantity increased
  - [ ] Inventory matches original value
  
- [ ] Create discount with usage limit
  - [ ] First order with code → Success
  - [ ] Second order with same code → Error (if limit=1)
  
- [ ] Validate discount code
  - [ ] Valid code under limit → Success
  - [ ] Valid code at limit → Error
  
- [ ] Update discount usage limit
  - [ ] Admin can change limit
  - [ ] New limit applies to future orders

---

## 🚀 Deployment Notes

### Database Migrations
**NONE NEEDED** ✅

All fields already exist in schema:
- `ProductVariant.inventoryQuantity` (exists)
- `Discount.usageLimit` (exists)
- `Order.appliedDiscountId` (exists)

### Backward Compatibility
- ✅ usageLimit is nullable (null = unlimited)
- ✅ Existing discounts without limit continue to work
- ✅ Existing orders unaffected
- ✅ No breaking changes

### Performance Impact
- Minimal ✅
- Decrement/increment operations are fast
- Usage count queries are indexed by appliedDiscountId
- Happens inside transactions (atomic)

### Error Scenarios Handled
- ✅ Product without variants
- ✅ Cart with mixed variant/non-variant items  
- ✅ Discount at exact limit boundary
- ✅ Transaction rollback on any error

---

