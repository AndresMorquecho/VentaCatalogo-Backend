
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkInTransit() {
  try {
    const orders = await prisma.order.findMany({
      where: { status: 'EN_TRANSITO' },
      select: { receiptNumber: true, status: true, type: true }
    });

    console.log(`Found ${orders.length} orders in EN_TRANSITO`);
    orders.forEach((o: any) => {
      console.log(`- ${o.receiptNumber} (${o.type})`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkInTransit();
