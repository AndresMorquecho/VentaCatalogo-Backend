import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const from = new Date('2026-04-22T00:00:00');
  const to = new Date('2026-05-04T23:59:59');
  
  const count = await prisma.financialRecord.count({
    where: { date: { gte: from, lte: to } }
  });
  
  console.log(`Financial records from 22/04 to 04/05: ${count}`);
  
  // Also count by summaryTable category relevance
  const records = await prisma.financialRecord.findMany({
    where: { date: { gte: from, lte: to } },
    select: { source: true, movementType: true, toAccountType: true, fromAccountType: true, paymentMethod: true, transactionGroupId: true },
  });
  
  // Count unique cards (grouped by transactionGroupId)
  const groups = new Set<string>();
  for (const r of records) {
    groups.add(r.transactionGroupId || `SOLO-${Math.random()}`);
  }
  console.log(`Unique transaction cards: ${groups.size}`);
  
  // Estimate wallet rows
  const walletRows = records.filter(r => r.toAccountType === 'WALLET' || r.fromAccountType === 'WALLET').length;
  const bankRows = records.filter(r => r.paymentMethod && ['TRANSFERENCIA', 'DEPOSITO', 'CHEQUE'].includes(r.paymentMethod)).length;
  
  console.log(`Wallet-related records: ${walletRows}`);
  console.log(`Bank-related records: ${bankRows}`);
  console.log(`Total raw records: ${records.length}`);
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
