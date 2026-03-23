/**
 * Script de limpieza RÁPIDA (sin confirmación)
 * ⚠️ SOLO PARA DESARROLLO - NO USAR EN PRODUCCIÓN
 *
 * Preserva: clients, brands, bank_accounts, users, roles
 * Elimina: todo lo demás (pedidos, pagos, créditos, etc.)
 *
 * Uso:
 *   node prisma/quick-clean.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function quickClean() {
  console.log('🔄 Limpieza rápida iniciada...\n');

  try {
    // --- Tablas sin dependencias o de auditoría ---
    await prisma.auditLog.deleteMany({});
    await prisma.loyaltyRedemption.deleteMany({});
    await prisma.loyaltyRuleBrand.deleteMany({});
    await prisma.loyaltyRule.deleteMany({});
    await prisma.loyaltyPrize.deleteMany({});
    await prisma.cashClosure.deleteMany({});
    await prisma.call.deleteMany({});

    // --- Catálogos ---
    await prisma.catalogDelivery.deleteMany({});
    await prisma.catalogInventory.deleteMany({});

    // --- Movimientos de inventario ---
    await prisma.inventoryMovement.deleteMany({});

    // --- Recompensas ---
    await prisma.rewardApplication.deleteMany({});

    // --- Créditos y cuentas de clientes ---
    await prisma.clientCredit.deleteMany({});
    await prisma.clientAccount.deleteMany({});

    // --- Recargas de billetera ---
    await prisma.walletRecharge.deleteMany({});

    // --- Registros financieros ---
    await prisma.financialRecord.deleteMany({});

    // --- Pagos e items de órdenes ---
    await prisma.orderPayment.deleteMany({});
    await prisma.orderItem.deleteMany({});

    // --- Órdenes y recibos ---
    await prisma.order.deleteMany({});
    await prisma.orderReceipt.deleteMany({});

    // --- Lotes de recepción ---
    await prisma.receptionBatch.deleteMany({});

    // --- Resetear saldos bancarios a 0 ---
    await prisma.bankAccount.updateMany({ data: { currentBalance: 0 } });

    // --- Verificación ---
    const [clients, brands, banks, users] = await Promise.all([
      prisma.client.count(),
      prisma.brand.count(),
      prisma.bankAccount.count(),
      prisma.user.count(),
    ]);

    console.log('✅ Limpieza completada\n');
    console.log('Preservados:');
    console.log(`  - ${clients} clientes`);
    console.log(`  - ${brands} marcas`);
    console.log(`  - ${banks} cuentas bancarias (saldo reseteado a $0)`);
    console.log(`  - ${users} usuarios\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

quickClean();
