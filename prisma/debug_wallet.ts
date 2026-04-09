
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugClient(clientId: string) {
  console.log(`--- Debugging Client: ${clientId} ---`);

  const clientAccount = await prisma.clientAccount.findUnique({
    where: { clientId },
    include: {
      credits: true
    }
  });

  if (!clientAccount) {
    console.log('Client Account not found');
    return;
  }

  const availableCreditsSum = clientAccount.credits
    .filter(c => c.status === 'AVAILABLE')
    .reduce((sum, c) => sum + Number(c.remainingAmount), 0);

  const usedCreditsSum = clientAccount.credits
    .filter(c => c.status === 'USED')
    .reduce((sum, c) => sum + Number(c.amount), 0);
    
  const partialCreditsSum = clientAccount.credits
    .filter(c => c.status === 'AVAILABLE' && Number(c.remainingAmount) < Number(c.amount))
    .reduce((sum, c) => sum + (Number(c.amount) - Number(c.remainingAmount)), 0);

  console.log(`Summary info:`);
  console.log(`- totalCreditAvailable (Summary Field): ${clientAccount.totalCreditAvailable}`);
  console.log(`- Sum of AVAILABLE credits (remainingAmount): ${availableCreditsSum}`);
  console.log(`- Total Credits Generated: ${clientAccount.credits.reduce((sum, c) => sum + Number(c.amount), 0)}`);
  console.log(`- Total Credits Used (calculated from records): ${usedCreditsSum + partialCreditsSum}`);
  console.log(`- Discrepancy: ${Number(clientAccount.totalCreditAvailable) - availableCreditsSum}`);

  const walletFinancialRecords = await prisma.financialRecord.findMany({
    where: {
      clientId,
      source: 'WALLET'
    },
    orderBy: { date: 'desc' }
  });

  console.log(`\nWallet Financial Records:`);
  walletFinancialRecords.forEach(fr => {
    console.log(`- ${fr.date.toISOString()} | ${fr.referenceNumber} | ${fr.amount} | ${fr.movementType} | Bal: ${fr.balanceAfter}`);
  });
}

const clientId = process.argv[2] || '62c57422-5f42-4218-998b-45d1133e2ce2';
debugClient(clientId).then(() => prisma.$disconnect());
