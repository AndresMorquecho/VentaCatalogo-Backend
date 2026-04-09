import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const r = await prisma.financialRecord.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { notes: true, referenceNumber: true }
  });
  console.log('--- REFRESH ---');
  console.log('REF:', r?.referenceNumber);
  console.log('NOTES:', r?.notes);
}
main().catch(console.error).finally(() => prisma.$disconnect());
