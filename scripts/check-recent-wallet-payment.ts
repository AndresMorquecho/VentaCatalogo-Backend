import { prisma } from '../src/lib/prisma';

/**
 * Script rápido para verificar el último pago con billetera virtual
 */

async function checkRecentWalletPayment() {
  console.log('🔍 Buscando el último pago con billetera virtual...\n');

  try {
    // Buscar el último registro financiero con BILLETERA_VIRTUAL
    const lastWalletPayment = await prisma.financialRecord.findFirst({
      where: {
        paymentMethod: 'BILLETERA_VIRTUAL'
      },
      orderBy: { createdAt: 'desc' },
      include: {
        client: {
          select: {
            firstName: true,
            identificationNumber: true
          }
        }
      }
    });

    if (!lastWalletPayment) {
      console.log('❌ NO se encontró ningún registro financiero con BILLETERA_VIRTUAL');
      console.log('   Esto significa que el registro NO se está creando.\n');
      
      // Buscar el último pedido para ver qué método de pago se usó
      const lastOrder = await prisma.order.findFirst({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          receiptNumber: true,
          paymentMethod: true,
          createdAt: true,
          clientId: true
        }
      });
      
      if (lastOrder) {
        console.log('📦 Último pedido creado:');
        console.log(`   ID: ${lastOrder.id}`);
        console.log(`   Recibo: ${lastOrder.receiptNumber}`);
        console.log(`   Método de pago: ${lastOrder.paymentMethod}`);
        console.log(`   Fecha: ${lastOrder.createdAt.toISOString()}`);
        console.log(`   Cliente: ${lastOrder.clientId}\n`);
      }
      
      return;
    }

    console.log('✅ Se encontró un registro financiero con BILLETERA_VIRTUAL\n');
    console.log('─'.repeat(60));
    console.log(`📝 ID: ${lastWalletPayment.id}`);
    console.log(`   Tipo: ${lastWalletPayment.type}`);
    console.log(`   Source: ${lastWalletPayment.source}`);
    console.log(`   Movement Type: ${lastWalletPayment.movementType}`);
    console.log(`   Payment Method: ${lastWalletPayment.paymentMethod}`);
    console.log(`   Monto: $${Number(lastWalletPayment.amount).toFixed(2)}`);
    console.log(`   Fecha: ${lastWalletPayment.date.toISOString()}`);
    console.log(`   Creado: ${lastWalletPayment.createdAt.toISOString()}`);
    
    if (lastWalletPayment.client) {
      console.log(`   Cliente: ${lastWalletPayment.client.firstName} (${lastWalletPayment.client.identificationNumber || 'N/A'})`);
    }
    
    console.log(`   Order ID: ${lastWalletPayment.orderId || 'NULL'}`);
    console.log(`   User Reference: ${lastWalletPayment.userReference || 'NULL'}`);
    
    // Verificar balance snapshots
    const hasBalanceSnapshots = lastWalletPayment.balanceBefore != null && lastWalletPayment.balanceAfter != null;
    
    if (hasBalanceSnapshots) {
      console.log(`   ✅ Balance Before: $${Number(lastWalletPayment.balanceBefore).toFixed(2)}`);
      console.log(`   ✅ Balance After: $${Number(lastWalletPayment.balanceAfter).toFixed(2)}`);
    } else {
      console.log(`   ❌ Balance Before: ${lastWalletPayment.balanceBefore}`);
      console.log(`   ❌ Balance After: ${lastWalletPayment.balanceAfter}`);
    }
    
    console.log('─'.repeat(60));
    
    // Verificar si cumple con los criterios para mostrar la tarjeta
    console.log('\n🎯 Verificación de criterios para mostrar tarjeta:');
    
    const checks = [
      { name: 'paymentMethod === BILLETERA_VIRTUAL', pass: lastWalletPayment.paymentMethod === 'BILLETERA_VIRTUAL' },
      { name: 'source === ORDER_PAYMENT', pass: lastWalletPayment.source === 'ORDER_PAYMENT' },
      { name: 'movementType === INTERNAL', pass: lastWalletPayment.movementType === 'INTERNAL' },
      { name: 'Tiene balanceBefore', pass: lastWalletPayment.balanceBefore != null },
      { name: 'Tiene balanceAfter', pass: lastWalletPayment.balanceAfter != null },
    ];
    
    checks.forEach(check => {
      console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`);
    });
    
    const allPass = checks.every(c => c.pass);
    
    if (allPass) {
      console.log('\n✅ El registro cumple TODOS los criterios. Debería aparecer la tarjeta.');
    } else {
      console.log('\n❌ El registro NO cumple todos los criterios. Por eso no aparece la tarjeta.');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkRecentWalletPayment();
