import { prisma } from '../src/lib/prisma';

async function checkOrders() {
  console.log('=== Checking Orders ===\n');
  
  // Get some delivered orders
  const deliveredOrders = await prisma.order.findMany({
    where: {
      status: 'ENTREGADO'
    },
    take: 10,
    orderBy: {
      transactionDate: 'desc'
    },
    select: {
      id: true,
      orderNumber: true,
      receiptNumber: true,
      clientId: true,
      status: true,
      total: true,
      brand: {
        select: {
          name: true
        }
      }
    }
  });
  
  console.log(`Found ${deliveredOrders.length} delivered orders:\n`);
  
  deliveredOrders.forEach(order => {
    console.log(`ID: ${order.id}`);
    console.log(`Order Number: ${order.orderNumber}`);
    console.log(`Receipt: ${order.receiptNumber}`);
    console.log(`Client ID: ${order.clientId}`);
    console.log(`Brand: ${order.brand?.name || 'N/A'}`);
    console.log(`Total: $${order.total}`);
    console.log('---');
  });
}

checkOrders()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
