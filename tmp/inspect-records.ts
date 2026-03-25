import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const records = await prisma.financialRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      amount: true,
      notes: true,
      type: true,
      clientName: true
    }
  });

  console.log('--- LAST 5 FINANCIAL RECORDS ---');
  records.forEach(r => {
    console.log(`ID: ${r.id} | Amount: ${r.amount} | Type: ${r.type} | Client: ${r.clientName}`);
    console.log(`Notes: "${r.notes}"`);
    console.log('--------------------------------');
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
