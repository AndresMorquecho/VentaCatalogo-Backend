
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const startOfDay = new Date('2026-04-13T00:00:00Z');
  const endOfDay = new Date('2026-04-13T23:59:59Z');

  const records = await prisma.financialRecord.findMany({
    where: {
      date: { gte: startOfDay, lte: endOfDay },
      source: 'CREDIT_DISTRIBUTION'
    }
  });

  console.log(`Found ${records.length} Credit Distribution records today.`);
  let totalDist = 0;
  records.forEach(r => {
    console.log(`Record ${r.id}: ${r.movementType} | Amt: ${r.amount} | TargetAccount: ${r.bankAccountId || 'NULL'}`);
    if (r.movementType === 'EXPENSE') totalDist += Number(r.amount);
  });
  console.log(`Total Distribution EXPENSE amount: ${totalDist}`);

  const reversals = await prisma.financialRecord.findMany({
    where: {
      date: { gte: startOfDay, lte: endOfDay },
      isReversal: true
    }
  });
  console.log(`Found ${reversals.length} reversal records today.`);
}

check().then(() => prisma.$disconnect());
