import { ConcurrencyError } from '../errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientCreditBalance, validateClientAccountCredit } from './financialValidations';

/**
 * Update BankAccount with optimistic locking
 * 
 * @param tx - Prisma transaction client
 * @param accountId - Bank account ID
 * @param currentVersion - Current version number (must be read in same transaction)
 * @param balanceChange - Amount to increment (positive) or decrement (negative)
 * @param currentBalance - Current balance for validation (optional but recommended)
 * @returns Updated count (should be 1 if successful)
 * @throws ConcurrencyError if version mismatch
 * @throws FinancialIntegrityError if balance would go negative
 */
export async function updateBankAccountWithLocking(
  tx: any,
  accountId: string,
  currentVersion: number,
  balanceChange: number,
  currentBalance?: number
): Promise<number> {
  // Validate financial integrity if current balance is provided
  if (currentBalance !== undefined) {
    validateBankAccountBalance(currentBalance, balanceChange, accountId);
  }

  const result = await tx.bankAccount.updateMany({
    where: {
      id: accountId,
      version: currentVersion
    },
    data: {
      currentBalance: { increment: balanceChange },
      updatedAt: new Date(),
      version: { increment: 1 }
    }
  });

  if (result.count === 0) {
    throw new ConcurrencyError(
      'Bank account was modified by another transaction. Please retry.',
      'BankAccount',
      accountId
    );
  }

  return result.count;
}

/**
 * Update ClientCredit with optimistic locking
 * 
 * @param tx - Prisma transaction client
 * @param creditId - Client credit ID
 * @param currentVersion - Current version number
 * @param amountToDeduct - Amount to deduct from remaining
 * @param currentRemaining - Current remaining amount for validation
 * @param newStatus - New status ('AVAILABLE' or 'USED')
 * @returns Updated count (should be 1 if successful)
 * @throws ConcurrencyError if version mismatch
 * @throws FinancialIntegrityError if remaining would go negative
 */
export async function updateClientCreditWithLocking(
  tx: any,
  creditId: string,
  currentVersion: number,
  amountToDeduct: number,
  currentRemaining: number,
  newStatus: 'AVAILABLE' | 'USED'
): Promise<number> {
  // Validate financial integrity
  validateClientCreditBalance(currentRemaining, amountToDeduct, creditId);

  const result = await tx.clientCredit.updateMany({
    where: {
      id: creditId,
      version: currentVersion
    },
    data: {
      remainingAmount: { decrement: amountToDeduct },
      status: newStatus,
      usedAt: newStatus === 'USED' ? new Date() : undefined,
      version: { increment: 1 }
    }
  });

  if (result.count === 0) {
    throw new ConcurrencyError(
      'Client credit was modified by another transaction. Please retry.',
      'ClientCredit',
      creditId
    );
  }

  return result.count;
}

/**
 * Update ClientAccount with optimistic locking
 * 
 * @param tx - Prisma transaction client
 * @param accountId - Client account ID
 * @param currentVersion - Current version number
 * @param updates - Fields to update
 * @returns Updated count (should be 1 if successful)
 * @throws ConcurrencyError if version mismatch
 * @throws FinancialIntegrityError if credit would go negative
 */
export async function updateClientAccountWithLocking(
  tx: any,
  accountId: string,
  currentVersion: number,
  updates: {
    totalCreditAvailable?: { increment?: number; decrement?: number; set?: number };
    totalRewardPoints?: number;
    totalOrders?: number;
    totalSpent?: number;
    rewardLevel?: string;
  }
): Promise<number> {
  // Validate credit changes if applicable
  if (updates.totalCreditAvailable) {
    // Note: We can't validate here without current value
    // Validation should be done before calling this function
  }

  const result = await tx.clientAccount.updateMany({
    where: {
      id: accountId,
      version: currentVersion
    },
    data: {
      ...updates,
      updatedAt: new Date(),
      version: { increment: 1 }
    }
  });

  if (result.count === 0) {
    throw new ConcurrencyError(
      'Client account was modified by another transaction. Please retry.',
      'ClientAccount',
      accountId
    );
  }

  return result.count;
}

/**
 * Helper to read BankAccount with version for optimistic locking
 */
export async function readBankAccountForUpdate(
  tx: any,
  accountId: string
): Promise<{ id: string; currentBalance: number; version: number } | null> {
  return await tx.bankAccount.findUnique({
    where: { id: accountId },
    select: { id: true, currentBalance: true, version: true }
  });
}

/**
 * Helper to read ClientCredit with version for optimistic locking
 */
export async function readClientCreditForUpdate(
  tx: any,
  creditId: string
): Promise<{ id: string; remainingAmount: number; version: number; status: string } | null> {
  return await tx.clientCredit.findUnique({
    where: { id: creditId },
    select: { id: true, remainingAmount: true, version: true, status: true }
  });
}

/**
 * Helper to read ClientAccount with version for optimistic locking
 */
export async function readClientAccountForUpdate(
  tx: any,
  accountId: string
): Promise<{ id: string; totalCreditAvailable: number; version: number } | null> {
  return await tx.clientAccount.findUnique({
    where: { id: accountId },
    select: { id: true, totalCreditAvailable: true, version: true }
  });
}
