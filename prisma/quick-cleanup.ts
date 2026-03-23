import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Iniciando limpieza rápida de la base de datos...');

  try {
    // El orden es importante por las claves foráneas
    
    console.log('🗑️  Borrando movimientos y registros financieros...');
    await prisma.financialRecord.deleteMany();
    await prisma.orderPayment.deleteMany();
    await prisma.clientCredit.deleteMany();
    await prisma.walletRecharge.deleteMany();
    await prisma.cashClosure.deleteMany();
    await prisma.processingRequest.deleteMany();

    console.log('🗑️  Borrando registros de cambios y lotes...');
    await prisma.exchangeBatchItem.deleteMany();
    await prisma.exchangeBatch.deleteMany();
    await prisma.orderExchangeItem.deleteMany();
    await prisma.orderExchange.deleteMany();

    console.log('🗑️  Borrando pedidos y recepciones...');
    await prisma.inventoryMovement.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.catalogDelivery.deleteMany();
    await prisma.rewardApplication.deleteMany();
    await prisma.call.deleteMany();
    await prisma.loyaltyRedemption.deleteMany();
    
    // Antes de borrar pedidos, desvincular relaciones circulares si existen (parentOrder)
    await prisma.order.updateMany({
      data: { parentOrderId: null, loyaltyRedemptionId: null, exchangeItemId: null }
    });
    
    await prisma.order.deleteMany();
    await prisma.orderReceipt.deleteMany();
    await prisma.receptionBatch.deleteMany();
    await prisma.catalogInventory.deleteMany();

    console.log('🗑️  Reiniciando estados de cuentas de clientes...');
    // En lugar de borrar ClientAccount (que está vinculado 1:1 a Client), reseteamos sus valores
    await prisma.clientAccount.updateMany({
      data: {
        totalCreditAvailable: 0,
        totalRewardPoints: 0,
        totalOrders: 0,
        totalSpent: 0,
        rewardLevel: 'BRONCE'
      }
    });

    console.log('🗑️  Borrando logs de auditoría...');
    await prisma.auditLog.deleteMany();

    console.log('✨ Base de datos limpia.');
    console.log('📦 Se mantuvieron: Clientes, Marcas, Cuentas Bancarias, Usuarios, Roles y Reglas de Fidelización.');

  } catch (error) {
    console.error('❌ Error durante la limpieza:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
