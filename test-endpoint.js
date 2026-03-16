const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testEndpoint() {
  try {
    // Simular lo que hace el endpoint getReceptionBatches
    const batches = await prisma.receptionBatch.findMany({
      select: {
        id: true,
        packingNumber: true,
        packingTotal: true,
        receptionDate: true,
        receivedByName: true,
        createdAt: true,
        notes: true,
        orders: {
          select: {
            id: true,
            receiptNumber: true,
            clientName: true,
            brandName: true,
            brandId: true,
            invoiceNumber: true,
            realInvoiceTotal: true,
            total: true,
            status: true
          }
        }
      },
      orderBy: { receptionDate: 'desc' }
    });
    
    console.log('=== RESPUESTA DEL ENDPOINT ===');
    console.log('Total de batches:', batches.length);
    console.log('\nJSON que se enviaría:');
    console.log(JSON.stringify({ success: true, data: batches }, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testEndpoint();
