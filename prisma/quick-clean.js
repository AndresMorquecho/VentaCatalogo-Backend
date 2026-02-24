/**
 * Script de limpieza RÁPIDA (sin confirmación)
 * ⚠️ SOLO PARA DESARROLLO - NO USAR EN PRODUCCIÓN
 * 
 * Uso:
 *   node backend/prisma/quick-clean.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function quickClean() {
  console.log('🔄 Limpieza rápida iniciada...\n');

  try {
    // Eliminar en orden de dependencias
    await prisma.user.deleteMany({});
    await prisma.loyaltyRule.deleteMany({});
    await prisma.loyaltyPrize.deleteMany({});
    await prisma.cashClosure.deleteMany({});
    await prisma.call.deleteMany({});
    await prisma.inventoryMovement.deleteMany({});
    await prisma.rewardApplication.deleteMany({});
    await prisma.clientCredit.deleteMany({});
    await prisma.clientAccount.deleteMany({});
    await prisma.financialRecord.deleteMany({});
    await prisma.orderPayment.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});

    // Contar lo que quedó
    const clients = await prisma.client.count();
    const brands = await prisma.brand.count();
    const banks = await prisma.bankAccount.count();

    console.log('✅ Limpieza completada\n');
    console.log(`Preservados:`);
    console.log(`  - ${clients} clientes`);
    console.log(`  - ${brands} marcas`);
    console.log(`  - ${banks} cuentas bancarias\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

quickClean();
