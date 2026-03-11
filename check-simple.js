const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const orders = await prisma.order.findMany({
    where: { receiptNumber: 'ORD-20260311-001' },
    select: { id: true, status: true, total: true, parentOrderId: true }
  });
  console.log('COUNT:' + orders.length);
  for (const o of orders) {
    console.log(`ID:${o.id}|STATUS:${o.status}|TOTAL:${o.total}|PARENT:${o.parentOrderId}`);
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
