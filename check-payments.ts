import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const orders = await prisma.order.findMany({
    where: { receiptNumber: 'ORD-20260311-001' },
    include: {
      payments: true,
      brand: true
    }
  });
  console.log('Orders found:', orders.length);
  orders.forEach(o => {
    const paid = o.payments.reduce((acc: any, p: any) => acc + Number(p.amount), 0);
    console.log(`Order ID: ${o.id}, Status: ${o.status}, Total: ${o.total}, Paid: ${paid}, Parent: ${o.parentOrderId}`);
  });
}

check().catch(console.error).finally(() => prisma.$disconnect());
