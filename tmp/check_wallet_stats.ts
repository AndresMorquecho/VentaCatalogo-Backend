import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const abonos = await prisma.financialRecord.count({
    where: { fromAccountType: 'WALLET' }
  });
  const recargas = await prisma.financialRecord.count({
    where: { toAccountType: 'WALLET' }
  });
  console.log(`Abonos (from Wallet): ${abonos}`);
  console.log(`Recargas (to Wallet): ${recargas}`);

  // Sample abono
  const sample = await prisma.financialRecord.findFirst({
    where: { fromAccountType: 'WALLET' },
    select: { id: true, type: true, source: true, amount: true, date: true }
  });
  console.log('Sample Abono:', sample);
}
main().catch(console.error).finally(() => prisma.$disconnect());
