import { GetActiveExchangeOrderIdsUseCase } from '../src/features/orders/application/GetActiveExchangeOrderIds.usecase';

async function testEndpoint() {
  console.log('=== Testing GetActiveExchangeOrderIds Use Case ===\n');
  
  const useCase = new GetActiveExchangeOrderIdsUseCase();
  
  // Test without clientId filter
  console.log('Test 1: Without clientId filter');
  const allIds = await useCase.execute();
  console.log(`Result: ${JSON.stringify(allIds)}`);
  console.log(`Count: ${allIds.length}\n`);
  
  // Test with a specific clientId
  if (allIds.length > 0) {
    // Get the clientId for the first order
    const { prisma } = await import('../src/lib/prisma');
    const order = await prisma.order.findUnique({
      where: { id: allIds[0] },
      select: { clientId: true }
    });
    
    if (order) {
      console.log(`Test 2: With clientId filter (${order.clientId})`);
      const filteredIds = await useCase.execute(order.clientId);
      console.log(`Result: ${JSON.stringify(filteredIds)}`);
      console.log(`Count: ${filteredIds.length}`);
    }
  }
}

testEndpoint()
  .catch(console.error)
  .finally(async () => {
    const { prisma } = await import('../src/lib/prisma');
    await prisma.$disconnect();
  });
