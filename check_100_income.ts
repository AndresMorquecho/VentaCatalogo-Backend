
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const startOfDay = new Date('2026-04-13T00:00:00Z');
  const endOfDay = new Date('2026-04-13T23:59:59Z');

  const records = await prisma.financialRecord.findMany({
    where: {
      date: { gte: startOfDay, lte: endOfDay },
      amount: { gte: 90, lte: 110 } // Look around 100
    }
  });

  console.log(`Found ${records.length} records around $100 today.`);
  records.forEach(r => {
    console.log(`Record ${r.id}: ${r.movementType} | Amt: ${r.amount} | Source: ${r.source} | Account: ${r.bankAccountId}`);
  });
}
// Fix typo in gte/lte if needed
check().then(() => prisma.$disconnect());
