const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function quickCheck() {
  console.log('Buscando ultimo pago con billetera virtual...\n');

  try {
    const lastWallet = await prisma.financialRecord.findFirst({
      where: { paymentMethod: 'BILLETERA_VIRTUAL' },
      orderBy: { createdAt: 'desc' }
    });

    if (!lastWallet) {
      console.log('NO se encontro ningun registro con BILLETERA_VIRTUAL');
      
      const lastOrder = await prisma.order.findFirst({
        orderBy: { createdAt: 'desc' },
        select: {
          receiptNumber: true,
          paymentMethod: true,
          createdAt: true
        }
      });
      
      if (lastOrder) {
        console.log('\nUltimo pedido:');
        console.log('  Recibo:', lastOrder.receiptNumber);
        console.log('  Metodo:', lastOrder.paymentMethod);
        console.log('  Fecha:', lastOrder.createdAt);
      }
    } else {
      console.log('SI se encontro registro:');
      console.log('  ID:', lastWallet.id);
      console.log('  Source:', lastWallet.source);
      console.log('  MovementType:', lastWallet.movementType);
      console.log('  Monto:', lastWallet.amount.toString());
      console.log('  BalanceBefore:', lastWallet.balanceBefore ? lastWallet.balanceBefore.toString() : 'NULL');
      console.log('  BalanceAfter:', lastWallet.balanceAfter ? lastWallet.balanceAfter.toString() : 'NULL');
      console.log('  UserReference:', lastWallet.userReference || 'NULL');
      console.log('  OrderId:', lastWallet.orderId || 'NULL');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

quickCheck();
