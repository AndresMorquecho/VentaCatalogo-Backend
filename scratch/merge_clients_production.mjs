import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function mergeClients() {
  const BUENO_ID = '09364f0b-8578-462f-8c20-1b45eed2f552'; // 0922421201
  const MALO_ID = '6421ba95-6292-4e87-bda5-196c7dc9c73c';  // 922421201
  
  const BUENO_NAME = 'NARCISA GABRIELA TOMALA MERO';
  const BUENO_DOC = '0922421201';

  console.log('--- STARTING MERGE TRANSACTION ---');

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Move Orders
      const orderUpdate = await tx.order.updateMany({
        where: { clientId: MALO_ID },
        data: { 
          clientId: BUENO_ID,
          clientName: BUENO_NAME
        }
      });
      console.log(`Updated ${orderUpdate.count} orders.`);

      // 2. Move Financial Records
      const financialUpdate = await tx.financialRecord.updateMany({
        where: { clientId: MALO_ID },
        data: { 
          clientId: BUENO_ID,
          clientName: BUENO_NAME,
          clientDocument: BUENO_DOC
        }
      });
      console.log(`Updated ${financialUpdate.count} financial records.`);

      // 3. Move Wallet Recharges
      const walletUpdate = await tx.walletRecharge.updateMany({
        where: { clientId: MALO_ID },
        data: { clientId: BUENO_ID }
      });
      console.log(`Updated ${walletUpdate.count} wallet recharges.`);

      // 4. Check for ClientAccount on Malo
      const maloAccount = await tx.clientAccount.findUnique({ where: { clientId: MALO_ID } });
      if (maloAccount) {
         throw new Error('Client Malo has a ClientAccount! Manual merge required.');
      }

      // 5. Delete the duplicate client
      const deletedClient = await tx.client.delete({
        where: { id: MALO_ID }
      });
      console.log(`Deleted duplicate client: ${deletedClient.identificationNumber}`);

      return {
        ordersMoved: orderUpdate.count,
        financialMoved: financialUpdate.count,
        deleted: deletedClient.identificationNumber
      };
    }, { 
      timeout: 60000 // 60 seconds for production latency
    });

    console.log('--- MERGE COMPLETED SUCCESSFULLY ---');
    console.log(result);

  } catch (error) {
    console.error('--- TRANSACTION FAILED (ROLLBACK) ---');
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

mergeClients();
