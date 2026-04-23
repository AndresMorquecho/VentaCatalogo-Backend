import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkAllTables() {
  const ids = [
    '09364f0b-8578-462f-8c20-1b45eed2f552', // 0922421201 (Bueno)
    '6421ba95-6292-4e87-bda5-196c7dc9c73c'  // 922421201 (Malo)
  ];

  const results = {};

  const tablesToCheck = [
    { model: 'orderReceipt', field: 'clientId' },
    { model: 'order', field: 'clientId' },
    { model: 'financialRecord', field: 'clientId' },
    { model: 'clientAccount', field: 'clientId' },
    { model: 'walletRecharge', field: 'clientId' },
    { model: 'inventoryMovement', field: 'clientId' },
    { model: 'call', field: 'clientId' },
    { model: 'loyaltyRedemption', field: 'clientId' },
    { model: 'catalogDelivery', field: 'clientId' },
    { model: 'exchangeBatchItem', field: 'clientId' },
    { model: 'orderExchange', field: 'clientId' },
    { model: 'client', field: 'referredById' }
  ];

  try {
    for (const id of ids) {
      results[id] = {};
      for (const table of tablesToCheck) {
        const count = await prisma[table.model].count({
          where: { [table.field]: id }
        });
        if (count > 0) {
          results[id][table.model] = count;
        }
      }
    }

    console.log('--- COMPREHENSIVE RELATION CHECK ---');
    console.log('CLIENT BUENO (0922421201):', results[ids[0]]);
    console.log('CLIENT MALO (922421201):', results[ids[1]]);
    console.log('-----------------------------------');

  } catch (error) {
    console.error('Error during check:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllTables();
