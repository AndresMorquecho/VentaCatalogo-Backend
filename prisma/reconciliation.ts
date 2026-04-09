/**
 * reconciliation.ts — Phase 4.3 / Phase 5 Fix #2
 *
 * Financial Reconciliation Script
 *
 * PRINCIPIO CORRECTO (Phase 5 Fix #2):
 *   balance = SUM(INCOME) - SUM(EXPENSE)
 *   isReversal es SOLO informativo (UI/auditoría), NO se excluye del cálculo.
 *
 * Los EXPENSE de reversión son movimientos reales (dinero que salió de caja).
 * Los INCOME de reversión son movimientos reales (dinero que entró a billetera).
 * Incluirlos en el balance = cálculo correcto y auténtico.
 *
 * Run: npx ts-node --project tsconfig.json prisma/reconciliation.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ReconciliationResult {
  bankAccountId: string;
  accountName: string;
  accountType: string;
  dbBalance: number;
  calculatedBalance: number;
  totalIncome: number;
  totalExpense: number;
  reversalCount: number;  // Informational only
  difference: number;
  isBalanced: boolean;
}

async function reconcileFinancials(): Promise<void> {
  console.log('\n══════════════════════════════════════════════════');
  console.log('   RECONCILIACIÓN FINANCIERA — VentasCatalogo');
  console.log('   Phase 5 Fix #2: balance = SUM(INCOME) - SUM(EXPENSE)');
  console.log('══════════════════════════════════════════════════\n');

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { isActive: true }
  });

  const results: ReconciliationResult[] = [];
  let allBalanced = true;

  for (const account of bankAccounts) {
    // Phase 5 Fix #2: Include ALL records — isReversal does NOT exclude from calculation
    const incomeAgg = await (prisma.financialRecord as any).aggregate({
      where: {
        bankAccountId: account.id,
        movementType: 'INCOME',
      },
      _sum: { amount: true }
    });

    const expenseAgg = await (prisma.financialRecord as any).aggregate({
      where: {
        bankAccountId: account.id,
        movementType: 'EXPENSE',
      },
      _sum: { amount: true }
    });

    // Count reversals for informational display only (not for calculation)
    const reversalCount = await prisma.financialRecord.count({
      where: {
        bankAccountId: account.id,
        isReversal: true
      } as any
    });

    const totalIncome = Number(incomeAgg._sum?.amount || 0);
    const totalExpense = Number(expenseAgg._sum?.amount || 0);
    // Fix #2: Simple formula, no exclusions
    const calculatedBalance = totalIncome - totalExpense;
    const dbBalance = Number(account.currentBalance);
    const difference = Number((dbBalance - calculatedBalance).toFixed(2));
    const isBalanced = Math.abs(difference) < 0.01;

    if (!isBalanced) allBalanced = false;

    results.push({
      bankAccountId: account.id,
      accountName: account.name,
      accountType: account.type,
      dbBalance,
      calculatedBalance,
      totalIncome,
      totalExpense,
      reversalCount,
      difference,
      isBalanced
    });
  }

  // === Bank Account Results ===
  console.log('📊 CUENTAS BANCARIAS Y CAJA:\n');
  for (const r of results) {
    const status = r.isBalanced ? '✅' : '❌';
    console.log(`${status} [${r.accountType}] ${r.accountName}`);
    console.log(`   DB Balance:          $${r.dbBalance.toFixed(2)}`);
    console.log(`   Calculated:          $${r.calculatedBalance.toFixed(2)} (INCOME: $${r.totalIncome.toFixed(2)} - EXPENSE: $${r.totalExpense.toFixed(2)})`);
    console.log(`   Reversal records:    ${r.reversalCount} (informational only, included in totals)`);
    if (!r.isBalanced) {
      console.log(`   ⚠️  DISCREPANCY:      $${r.difference.toFixed(2)}`);
    }
    console.log('');
  }

  // === Wallet Reconciliation ===
  console.log('👛 BILLETERAS VIRTUALES:\n');
  const clientAccounts = await prisma.clientAccount.findMany({
    include: { client: { select: { firstName: true, identificationNumber: true } } }
  });

  let walletBalanced = true;
  for (const ca of clientAccounts) {
    // All records where wallet received money (INCOME to wallet)
    const walletIncome = await (prisma.financialRecord as any).aggregate({
      where: {
        clientId: ca.clientId,
        toAccountType: 'WALLET',
        movementType: 'INCOME',
      },
      _sum: { amount: true }
    });

    // All records where wallet spent money (EXPENSE from wallet)
    const walletExpense = await (prisma.financialRecord as any).aggregate({
      where: {
        clientId: ca.clientId,
        source: 'WALLET',
        movementType: 'EXPENSE',
      },
      _sum: { amount: true }
    });

    // Fix #2: Simple formula — no exclusions
    const calculatedWallet = Number(walletIncome._sum?.amount || 0) - Number(walletExpense._sum?.amount || 0);
    const dbWallet = Number(ca.totalCreditAvailable);
    const diff = Number((dbWallet - calculatedWallet).toFixed(2));
    const ok = Math.abs(diff) < 0.01;

    if (!ok) walletBalanced = false;

    if (!ok) {
      console.log(`❌ ${ca.client.firstName} (${ca.client.identificationNumber || 'S/N'})`);
      console.log(`   DB Wallet:    $${dbWallet.toFixed(2)}`);
      console.log(`   Calculated:   $${calculatedWallet.toFixed(2)}`);
      console.log(`   DISCREPANCY:  $${diff.toFixed(2)}\n`);
    }
  }

  if (walletBalanced) {
    console.log(`✅ Todas las billeteras cuadran (${clientAccounts.length} clientes)\n`);
  }

  // === Final Summary ===
  console.log('══════════════════════════════════════════════════');
  if (allBalanced && walletBalanced) {
    console.log('✅ RESULTADO: Sistema financiero EQUILIBRADO');
    console.log('   balance = SUM(INCOME) - SUM(EXPENSE) — CORRECTO');
    console.log('   No se detectaron discrepancias.');
  } else {
    console.log('❌ RESULTADO: DISCREPANCIAS DETECTADAS');
    console.log('   Posibles causas:');
    console.log('   - Actualización directa de balances sin FinancialRecord');
    console.log('   - Transacciones incompletas (timeout)');
    console.log('   - Bug de doble wallet credit (verifique source=WALLET_REFUND vs CREDIT_DISTRIBUTION)');
  }
  console.log('══════════════════════════════════════════════════\n');
}

reconcileFinancials()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
