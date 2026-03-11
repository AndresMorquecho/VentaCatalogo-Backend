
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const receiptNumber = 'ORD-20260311-004';
  const orders = await prisma.order.findMany({
    where: { receiptNumber },
    include: {
      items: true,
      payments: true,
    }
  });

  console.log(JSON.stringify(orders.map(o => ({
    id: o.id,
    receiptNumber: o.receiptNumber,
    status: o.status,
    total: o.total,
    paid: o.payments.reduce((acc, p) => acc + Number(p.amount), 0),
    createdAt: o.createdAt,
    brandId: o.brandId,
    parentOrderId: o.parentOrderId
  })), null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
