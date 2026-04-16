
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const startOfDay = new Date('2026-04-13T00:00:00Z');
  const endOfDay = new Date('2026-04-13T23:59:59Z');

  const records = await prisma.financialRecord.findMany({
    where: {
      date: {
        gte: startOfDay,
        lte: endOfDay
      }
    },
    include: {
      bankAccount: true
    }
  });

  console.log(`Found ${records.length} records today.`);

  let globalIncome = 0;
  let globalExpense = 0;
  let bankBalances: Record<string, number> = {};

  records.forEach(r => {
    const amount = Number(r.amount);
    
    // Simulate buildTransactionCards informative logic
    const accountType = (r.toAccountType === 'WALLET' || r.fromAccountType === 'WALLET' || r.paymentMethod === 'BILLETERA_VIRTUAL' || r.paymentMethod === 'CREDITO_CLIENTE') ? 'WALLET' : (r.bankAccount?.type === 'CASH' ? 'CASH' : 'BANK');
    
    // Simple informative simulation
    const isWalletInternal = accountType === 'WALLET' && r.movementType === 'INTERNAL';
    const isDistributionIncome = r.source === 'CREDIT_DISTRIBUTION' && r.movementType === 'INCOME';
    const isInformative = isWalletInternal || isDistributionIncome;

    if (!isInformative) {
      if (r.movementType === 'INCOME') globalIncome += amount;
      if (r.movementType === 'EXPENSE') globalExpense += amount;
    }

    // Bank Account Impact (Simulation of real balance change in DB)
    if (r.bankAccountId) {
      const current = bankBalances[r.bankAccountId] || 0;
      bankBalances[r.bankAccountId] = current + (r.movementType === 'INCOME' ? amount : -amount);
    }

    console.log(`[${r.movementType}] ${r.type} | Source: ${r.source} | Account: ${r.bankAccount?.name || 'VIRTUAL'} | Amt: ${amount} | Informative: ${isInformative}`);
  });

  console.log('\n--- REPORT TOTALS ---');
  console.log(`Global Income: ${globalIncome}`);
  console.log(`Global Expense: ${globalExpense}`);
  console.log(`Neto: ${globalIncome - globalExpense}`);

  console.log('\n--- BANK BALANCES IMPACT (FROM TODAY OPER) ---');
  Object.entries(bankBalances).forEach(([id, bal]) => {
    console.log(`Bank ID ${id}: ${bal}`);
  });
  
  const totalBankImpact = Object.values(bankBalances).reduce((s, b) => s + b, 0);
  console.log(`Total Bank Impact: ${totalBankImpact}`);
}

check().then(() => prisma.$disconnect());
