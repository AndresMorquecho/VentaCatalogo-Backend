
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkExchanges() {
  try {
    const lastBatch = await prisma.exchangeBatch.findFirst({
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { order: { select: { id: true, receiptNumber: true, status: true } } } } }
    });

    if (!lastBatch) {
      console.log('No exchange batches found.');
      return;
    }

    console.log(`Last batch: ${lastBatch.id} - Status: ${lastBatch.status}`);
    lastBatch.items.forEach((item: any) => {
      console.log(`- Order: ${item.order.receiptNumber} - Status: ${item.order.status}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkExchanges();
