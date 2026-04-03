import { prisma } from '../src/lib/prisma';

async function createTestExchangeBatch() {
  console.log('=== Creating Test Exchange Batch ===\n');
  
  // 1. Get a delivered order
  const order = await prisma.order.findFirst({
    where: {
      status: 'ENTREGADO'
    },
    include: {
      client: true,
      brand: true
    }
  });
  
  if (!order) {
    console.log('No delivered orders found. Cannot create test batch.');
    return;
  }
  
  console.log(`Using order: ${order.orderNumber} (ID: ${order.id})`);
  console.log(`Client: ${order.client?.firstName || 'Unknown'}`);
  console.log(`Brand: ${order.brand?.name || 'Unknown'}\n`);
  
  // 2. Create an ExchangeBatch
  const batch = await prisma.exchangeBatch.create({
    data: {
      batchNumber: `BATCH-TEST-${Date.now()}`,
      trackingGuide: `GUIDE-TEST-${Date.now()}`,
      status: 'ENVIADO', // Not ENTREGADO, so it should be filtered
      notes: 'Test batch for duplicate prevention',
      createdByName: 'Test Script'
    }
  });
  
  console.log(`Created batch: ${batch.batchNumber} (ID: ${batch.id})`);
  console.log(`Status: ${batch.status}\n`);
  
  // 3. Add the order to the batch
  const batchItem = await prisma.exchangeBatchItem.create({
    data: {
      batchId: batch.id,
      orderId: order.id,
      clientId: order.clientId,
      clientName: order.client?.firstName || 'Unknown',
      receiptNumber: order.receiptNumber || 'N/A',
      orderTotal: order.total,
      notes: 'Test item'
    }
  });
  
  console.log(`Added order to batch: ${batchItem.id}`);
  console.log(`Order ID in batch: ${batchItem.orderId}\n`);
  
  // 4. Verify the query works
  const activeIds = await prisma.exchangeBatchItem.findMany({
    where: {
      batch: {
        status: { not: 'ENTREGADO' }
      }
    },
    select: { orderId: true },
    distinct: ['orderId']
  });
  
  console.log(`=== Active Exchange Order IDs ===`);
  console.log(`Total: ${activeIds.length}`);
  activeIds.forEach(item => {
    console.log(`  - ${item.orderId}`);
  });
  
  console.log(`\n✅ Test batch created successfully!`);
  console.log(`\nNow try to add order ${order.orderNumber} (ID: ${order.id}) to a new exchange.`);
  console.log(`It should NOT appear in the modal.`);
}

createTestExchangeBatch()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
