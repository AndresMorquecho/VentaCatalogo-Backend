const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkBatches() {
  try {
    const batches = await prisma.receptionBatch.findMany({
      include: {
        orders: {
          select: {
            id: true,
            receiptNumber: true,
            status: true
          }
        }
      }
    });
    
    console.log('=== BATCHES EN BASE DE DATOS ===');
    console.log('Total de batches:', batches.length);
    console.log('\nDetalle:');
    batches.forEach(batch => {
      console.log(`\nBatch ID: ${batch.id}`);
      console.log(`Packing Number: ${batch.packingNumber}`);
      console.log(`Packing Total: ${batch.packingTotal}`);
      console.log(`Fecha: ${batch.receptionDate}`);
      console.log(`Pedidos: ${batch.orders.length}`);
      batch.orders.forEach(o => {
        console.log(`  - ${o.receiptNumber} (${o.status})`);
      });
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkBatches();
