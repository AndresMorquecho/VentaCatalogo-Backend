import { prisma } from '../src/lib/prisma';

async function main() {
  const records = await prisma.financialRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      amount: true,
      notes: true,
      referenceNumber: true,
      createdAt: true
    }
  });

  console.log(JSON.stringify(records, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
