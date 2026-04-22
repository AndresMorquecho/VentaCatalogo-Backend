const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function hardReset() {
  console.log('--- Iniciando Vaciado Total de Pedidos y Movimientos ---');
  
  try {
    // Orden de eliminación para respetar claves foráneas
    await prisma.financialRecord.deleteMany({});
    console.log('1. Registros financieros eliminados');
    
    await prisma.inventoryMovement.deleteMany({});
    console.log('2. Movimientos de inventario eliminados');
    
    await prisma.orderPayment.deleteMany({});
    console.log('3. Pagos de pedidos eliminados');
    
    await prisma.orderItem.deleteMany({});
    console.log('4. Items de pedidos eliminados');
    
    await prisma.catalogDelivery.deleteMany({});
    console.log('5. Entregas de catálogo eliminadas');

    await prisma.orderExchangeItem.deleteMany({});
    await prisma.orderExchange.deleteMany({});
    console.log('6. Cambios eliminados');

    await prisma.call.deleteMany({});
    console.log('6.1 Llamadas eliminadas');

    await prisma.loyaltyRedemption.deleteMany({});
    console.log('7. Redenciones eliminadas');

    await prisma.clientCredit.deleteMany({});
    await prisma.clientAccount.deleteMany({});
    await prisma.walletRecharge.deleteMany({});
    console.log('7.1 Cuentas y créditos de clientes eliminados');

    await prisma.order.deleteMany({});
    console.log('8. TODOS los pedidos eliminados');

    await prisma.client.deleteMany({});
    console.log('8.1 Todos los clientes eliminados');

    // Resetear saldos de bancos a 0
    await prisma.bankAccount.updateMany({
      data: { currentBalance: 0 }
    });
    console.log('9. Saldos de cuentas bancarias reseteados a $0');

    // Eliminar cierres de caja previos para empezar limpio
    await prisma.cashClosure.deleteMany({});
    console.log('10. Cierres de caja eliminados');

    console.log('--- Vaciado COMPLETADO ---');
  } catch (error) {
    console.error('Error durante el vaciado:', error);
  }
}

hardReset()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
