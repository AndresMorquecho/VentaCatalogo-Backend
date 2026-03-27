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
    // --- 1. Tables that depend on Order (FKs to Order) ---
    await prisma.orderItem.deleteMany({});
    await prisma.orderPayment.deleteMany({});
    await prisma.financialRecord.deleteMany({});
    await prisma.inventoryMovement.deleteMany({});
    await prisma.rewardApplication.deleteMany({});
    await prisma.catalogDelivery.deleteMany({});
    await prisma.exchangeBatchItem.deleteMany({});
    await prisma.orderExchangeItem.deleteMany({});
    await prisma.call.deleteMany({});

    // --- 2. Order itself (depends on Receipts, Batches, Redemptions) ---
    // Note: self-relation parentOrderId might be an issue if there are deep nests
    await prisma.order.deleteMany({});

    // --- 3. Tables that Order depends on ---
    await prisma.orderReceipt.deleteMany({});
    await prisma.receptionBatch.deleteMany({});
    await prisma.loyaltyRedemption.deleteMany({});
    await prisma.exchangeBatch.deleteMany({});
    await prisma.orderExchange.deleteMany({});

    // --- 4. Client Account & Wallet (depend on Client) ---
    await prisma.clientCredit.deleteMany({});
    await prisma.clientAccount.deleteMany({});
    await prisma.walletRecharge.deleteMany({});

    // --- 5. Loyalty & Catalogs (depend on Brands/Prizes) ---
    await prisma.loyaltyRuleBrand.deleteMany({});
    await prisma.loyaltyRule.deleteMany({});
    await prisma.loyaltyPrize.deleteMany({});
    await prisma.catalogInventory.deleteMany({});

    // --- 6. Standalone / Audit / System ---
    await prisma.auditLog.deleteMany({});
    await prisma.cashClosure.deleteMany({});
    await prisma.processingRequest.deleteMany({});

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
