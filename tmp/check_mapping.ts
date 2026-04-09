import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const fr = await prisma.financialRecord.findUnique({
    where: { referenceNumber: 'FIN-f4130c08-381' },
    select: { notes: true, orderPaymentId: true, type: true, source: true }
  });
  console.log(JSON.stringify(fr, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
