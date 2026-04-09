import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const records = await prisma.financialRecord.findMany({
    where: {
      notes: {
        contains: 'OR-2026-006'
      }
    },
    orderBy: { createdAt: 'desc' },
    select: { source: true, notes: true, referenceNumber: true }
  });
  console.log(JSON.stringify(records, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
