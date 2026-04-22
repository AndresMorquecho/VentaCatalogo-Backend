const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function countRecords() {
  const orders = await prisma.order.count();
  const payments = await prisma.orderPayment.count();
  const financials = await prisma.financialRecord.count();
  console.log(`Orders: ${orders}, Payments: ${payments}, Financials: ${financials}`);
}

countRecords()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
