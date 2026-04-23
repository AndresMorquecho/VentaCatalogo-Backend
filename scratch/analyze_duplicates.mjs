import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function analyze() {
  const identifiers = ['0922421201', '922421201'];
  
  try {
    const clients = await prisma.client.findMany({
      where: {
        identificationNumber: { in: identifiers }
      },
      include: {
        _count: {
          select: {
            orders: true,
            financialRecords: true,
            walletRecharges: true,
            orderReceipts: true,
            catalogDeliveries: true
          }
        }
      }
    });

    console.log('--- ANALYSIS OF DUPLICATE CLIENTS ---');
    clients.forEach(client => {
      console.log(`ID: ${client.id}`);
      console.log(`Identification: ${client.identificationNumber}`);
      console.log(`Name: ${client.firstName}`);
      console.log(`City: ${client.city}`);
      console.log(`Phone: ${client.phone1}`);
      console.log(`Created At: ${client.createdAt}`);
      console.log(`Relations:`, client._count);
      console.log('-----------------------------------');
    });

  } catch (error) {
    console.error('Error during analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyze();
