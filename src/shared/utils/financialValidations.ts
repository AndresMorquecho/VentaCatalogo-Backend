import { FinancialIntegrityError } from '../errors/FinancialIntegrityError';

/**
 * Validate that a bank account balance is not negative
 */
export function validateBankAccountBalance(
  currentBalance: number,
  change: number,
  accountId: string,
  accountName?: string
): void {
  const newBalance = currentBalance + change;
  
  if (newBalance < -0.01) { // Allow small floating point errors
    throw new FinancialIntegrityError(
      `Operation would result in negative bank account balance. ` +
      `Current: ${currentBalance.toFixed(2)}, Change: ${change.toFixed(2)}, ` +
      `Result: ${newBalance.toFixed(2)}${accountName ? ` (${accountName})` : ''}`,
      'NEGATIVE_BALANCE',
      'BankAccount',
      accountId,
      currentBalance,
      newBalance
    );
  }
}

/**
 * Validate that a client credit remaining amount is not negative
 */
export function validateClientCreditBalance(
  currentRemaining: number,
  deduction: number,
  creditId: string
): void {
  const newRemaining = currentRemaining - deduction;
  
  if (newRemaining < -0.01) { // Allow small floating point errors
    throw new FinancialIntegrityError(
      `Operation would result in negative credit balance. ` +
      `Current: ${currentRemaining.toFixed(2)}, Deduction: ${deduction.toFixed(2)}, ` +
      `Result: ${newRemaining.toFixed(2)}`,
      'NEGATIVE_CREDIT',
      'ClientCredit',
      creditId,
      currentRemaining,
      newRemaining
    );
  }
}

/**
 * Validate that a client account total credit is not negative
 */
export function validateClientAccountCredit(
  currentTotal: number,
  change: number,
  accountId: string
): void {
  const newTotal = currentTotal + change;
  
  if (newTotal < -0.01) { // Allow small floating point errors
    throw new FinancialIntegrityError(
      `Operation would result in negative client account credit. ` +
      `Current: ${currentTotal.toFixed(2)}, Change: ${change.toFixed(2)}, ` +
      `Result: ${newTotal.toFixed(2)}`,
      'NEGATIVE_CREDIT',
      'ClientAccount',
      accountId,
      currentTotal,
      newTotal
    );
  }
}

/**
 * Validate that an amount is positive
 */
export function validatePositiveAmount(
  amount: number,
  fieldName: string = 'amount'
): void {
  if (amount < 0) {
    throw new FinancialIntegrityError(
      `${fieldName} must be positive. Received: ${amount}`,
      'INVALID_STATE'
    );
  }
}

/**
 * Validate that payment amount does not exceed pending amount
 */
export function validatePaymentAmount(
  paymentAmount: number,
  pendingAmount: number,
  allowOverpayment: boolean = false
): void {
  if (!allowOverpayment && paymentAmount > pendingAmount + 0.01) {
    throw new FinancialIntegrityError(
      `Payment amount (${paymentAmount.toFixed(2)}) exceeds pending amount (${pendingAmount.toFixed(2)})`,
      'INVALID_STATE'
    );
  }
}
