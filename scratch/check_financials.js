const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkFinancials() {
  const lastRecords = await prisma.financialRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log('Last 10 Financial Records:', JSON.stringify(lastRecords, null, 2));

  const openClosures = await prisma.cashClosure.findMany({
    orderBy: { closedAt: 'desc' },
    take: 5
  });
  console.log('Recent Cash Closures:', JSON.stringify(openClosures, null, 2));
  
  // Total current balance across all bank accounts
  const accounts = await prisma.bankAccount.findMany();
  console.log('Bank Accounts Balances:', JSON.stringify(accounts.map(a => ({ name: a.name, balance: a.currentBalance })), null, 2));
}

checkFinancials()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
