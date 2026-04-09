import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const fr = await prisma.financialRecord.findFirst({
    where: { referenceNumber: 'FIN-f4130c08-381' }
  });
  if (!fr) return console.log('Not found');

  const allInGroup = await prisma.financialRecord.findMany({
    where: { transactionGroupId: fr.transactionGroupId },
    select: { source: true, notes: true, referenceNumber: true }
  });
  console.log(JSON.stringify(allInGroup, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
