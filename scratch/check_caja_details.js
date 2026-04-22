const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCaja() {
  const account = await prisma.bankAccount.findFirst({
    where: { name: 'Caja Principal' }
  });
  console.log('Account Details:', JSON.stringify(account, null, 2));

  const records = await prisma.financialRecord.findMany({
    where: { bankAccountId: account.id },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log('Last 20 records for Caja Principal:', JSON.stringify(records, null, 2));
}

checkCaja()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
