import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function inspectOrder() {
  const maloId = '6421ba95-6292-4e87-bda5-196c7dc9c73c';
  
  try {
    const orders = await prisma.order.findMany({
      where: { clientId: maloId },
      include: {
        items: true,
        payments: true,
        financialRecords: true
      }
    });

    console.log('--- ORDER INSPECTION (CLIENT MALO) ---');
    console.log(JSON.stringify(orders, null, 2));
    console.log('--------------------------------------');

  } catch (error) {
    console.error('Error during inspection:', error);
  } finally {
    await prisma.$disconnect();
  }
}

inspectOrder();
