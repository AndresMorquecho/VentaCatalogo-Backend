import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const frs = await prisma.financialRecord.findMany({
    where: { order: { receiptNumber: 'OR-2026-006' } },
    select: { source: true, notes: true, referenceNumber: true }
  });
  console.log('--- DB CHECK ---');
  console.log(JSON.stringify(frs, null, 2));

  const orders = await prisma.order.findMany({
    where: { receiptNumber: 'OR-2026-006' },
    select: { orderNumber: true, notes: true }
  });
  console.log('--- ORDERS CHECK ---');
  console.log(JSON.stringify(orders, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
