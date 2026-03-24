# Wallet Payment Transaction Card Fix

## Problem

When users made order payments using `BILLETERA_VIRTUAL` (virtual wallet) through the batch order creation endpoint (`/api/orders/batch`), the transaction cards were not appearing in the transactions view.

### Root Cause

The `BatchCreateOrder.usecase.ts` was creating financial records for wallet payments, but:
1. **Missing balance snapshots**: The `balanceBefore` and `balanceAfter` fields were not being populated
2. **Missing order reference**: The `orderId` field was not being set for single-order payments
3. **Missing user reference**: The `userReference` field (receipt number) was not being set

Without these fields, the frontend couldn't properly display the transaction cards with cumulative balances.

## Solution

Updated `BatchCreateOrder.usecase.ts` to capture balance snapshots before creating financial records:

### For Wallet Payments (BILLETERA_VIRTUAL)

```typescript
// Capture wallet balance snapshot BEFORE the payment is processed
const clientAccount = await tx.clientAccount.findUnique({
  where: { clientId: dto.clientId },
  select: { totalCreditAvailable: true }
});

let balanceBefore: number | null = null;
let balanceAfter: number | null = null;

if (clientAccount) {
  balanceBefore = parseFloat(clientAccount.totalCreditAvailable.toString());
  balanceAfter = balanceBefore - paymentAmount;
}

// Create financial record with balance snapshots
allFinancialRecords.push({
  // ... other fields
  balanceBefore: balanceBefore,
  balanceAfter: balanceAfter,
  orderId: dto.orders.length === 1 ? allOrders[0].id : null,
  userReference: receiptNumber,
  // ...
});
```

### For Bank Payments (EFECTIVO, TRANSFERENCIA, etc.)

```typescript
// Capture bank balance snapshot BEFORE the payment is processed
const bankAcc = await tx.bankAccount.findUnique({
  where: { id: bankId },
  select: { currentBalance: true }
});

let balanceBefore: number | null = null;
let balanceAfter: number | null = null;

if (bankAcc) {
  balanceBefore = parseFloat(bankAcc.currentBalance.toString());
  balanceAfter = balanceBefore + paymentAmount;
}

// Create financial record with balance snapshots
allFinancialRecords.push({
  // ... other fields
  balanceBefore: balanceBefore,
  balanceAfter: balanceAfter,
  orderId: dto.orders.length === 1 ? allOrders[0].id : null,
  userReference: paymentItem.method !== 'EFECTIVO' && transactionReference
    ? transactionReference
    : receiptNumber,
  // ...
});
```

## Files Modified

1. **Backend/VentaCatalogo-Backend/src/features/orders/application/BatchCreateOrder.usecase.ts**
   - Added balance snapshot capture for wallet payments (lines ~358-380)
   - Added balance snapshot capture for bank payments (lines ~320-355)
   - Added `orderId` field for single-order payments
   - Added `userReference` field with receipt number

## Testing

A test script was created to verify the fix:

```bash
cd Backend/VentaCatalogo-Backend
npx tsx scripts/test-wallet-payment-card.ts
```

This script:
- Finds recent wallet payment financial records
- Verifies they have balance snapshots
- Validates balance calculations
- Provides a summary report

## Expected Behavior After Fix

When a user makes a payment with `BILLETERA_VIRTUAL`:

1. A `FinancialRecord` is created with:
   - `type`: 'PAYMENT'
   - `source`: 'ORDER_PAYMENT'
   - `movementType`: 'INTERNAL'
   - `paymentMethod`: 'BILLETERA_VIRTUAL'
   - `balanceBefore`: Wallet balance before payment
   - `balanceAfter`: Wallet balance after payment
   - `orderId`: Order ID (if single order)
   - `userReference`: Receipt number

2. The transaction card appears in the transactions view showing:
   - Title: "Uso de Billetera Virtual"
   - Client name and document
   - Order/receipt information
   - Amount deducted from wallet
   - Cumulative balance (before → after)

## Related Components

- **Frontend**: `Temu/src/features/transactions/ui/TransactionsTable.tsx`
  - Already configured to display wallet payment cards
  - `WalletUseMovements` component shows balance snapshots
  
- **Backend**: `Backend/VentaCatalogo-Backend/src/features/payments/application/ProcessSplitPayment.usecase.ts`
  - Reference implementation that already had balance snapshots
  - Used as model for the fix

## Card Type Analysis

See `.kiro/specs/transaction-cards/card-types-analysis.md` for complete documentation on all transaction card types and their detection logic.

## Next Steps

1. Test with a real wallet payment through the batch order endpoint
2. Verify the transaction card appears correctly
3. Verify balance snapshots are accurate
4. Check that the cumulative balance displays correctly in the UI
