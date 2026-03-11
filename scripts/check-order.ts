
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

  console.log(`Found ${orders.length} orders for receipt ${receiptNumber}`);
  orders.forEach((o, i) => {
    console.log(`Order ${i + 1}: ID=${o.id}, ParentID=${o.parentOrderId}, Status=${o.status}, Total=${o.total}, PaymentsCount=${o.payments.length}`);
  });

  const receipt = await (prisma as any).orderReceipt.findUnique({
    where: { receiptNumber }
  });
  console.log(`Receipt header exists: ${!!receipt}`);
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
