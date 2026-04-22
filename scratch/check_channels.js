const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkChannels() {
  const stats = await prisma.order.groupBy({
    by: ['salesChannel'],
    _count: { id: true }
  });
  console.log('Orders by Channel:', JSON.stringify(stats, null, 2));
}

checkChannels()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
