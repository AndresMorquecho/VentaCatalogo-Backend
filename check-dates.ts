import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDates() {
  const orders = await prisma.order.findMany({
    select: {
      receiptNumber: true,
      receptionDate: true,
      status: true,
    },
    take: 5,
  });

  console.log('Sample orders:');
  orders.forEach(o => {
    console.log(`  ${o.receiptNumber}: ${o.receptionDate} (${o.status})`);
  });

  await prisma.$disconnect();
}

checkDates();
