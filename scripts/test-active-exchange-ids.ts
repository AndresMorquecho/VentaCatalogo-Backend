import { prisma } from '../src/lib/prisma';

async function testActiveExchangeIds() {
  console.log('=== Testing Active Exchange Order IDs ===\n');
  
  // 1. Get all ExchangeBatches
  const batches = await prisma.exchangeBatch.findMany({
    include: {
      items: true
    }
  });
  
  console.log(`Total ExchangeBatches: ${batches.length}\n`);
  
  batches.forEach(batch => {
    console.log(`Batch ID: ${batch.id}`);
    console.log(`Status: ${batch.status}`);
    console.log(`Tracking Guide: ${batch.trackingGuide}`);
    console.log(`Items: ${batch.items.length}`);
    batch.items.forEach(item => {
      console.log(`  - Order ID: ${item.orderId}, Client: ${item.clientName}`);
    });
    console.log('');
  });
  
  // 2. Get active exchange order IDs (status != 'ENTREGADO')
  const activeItems = await prisma.exchangeBatchItem.findMany({
    where: {
      batch: {
        status: { not: 'ENTREGADO' }
      }
    },
    select: { 
      orderId: true,
      clientId: true,
      clientName: true,
      batch: {
        select: {
          status: true,
          trackingGuide: true
        }
      }
    },
    distinct: ['orderId']
  });
  
  console.log(`\n=== Active Exchange Order IDs (status != 'ENTREGADO') ===`);
  console.log(`Total: ${activeItems.length}\n`);
  
  activeItems.forEach(item => {
    console.log(`Order ID: ${item.orderId}`);
    console.log(`Client ID: ${item.clientId}`);
    console.log(`Client Name: ${item.clientName}`);
    console.log(`Batch Status: ${item.batch.status}`);
    console.log(`Tracking Guide: ${item.batch.trackingGuide}`);
    console.log('');
  });
  
  // 3. Test with a specific clientId if there are any
  if (activeItems.length > 0) {
    const testClientId = activeItems[0].clientId;
    console.log(`\n=== Testing with clientId: ${testClientId} ===`);
    
    const filteredItems = await prisma.exchangeBatchItem.findMany({
      where: {
        batch: {
          status: { not: 'ENTREGADO' }
        },
        clientId: testClientId
      },
      select: { orderId: true },
      distinct: ['orderId']
    });
    
    console.log(`Order IDs for client ${testClientId}:`);
    filteredItems.forEach(item => {
      console.log(`  - ${item.orderId}`);
    });
  }
}

testActiveExchangeIds()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
