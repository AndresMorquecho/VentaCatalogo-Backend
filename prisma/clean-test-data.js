/**
 * Limpieza de datos de prueba (transaccionales)
 * Preserva: clientes, marcas, cuentas bancarias, usuarios, roles
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clean() {
  console.log('🔄 Limpiando datos transaccionales...\n');

  try {
    const r1 = await prisma.inventoryMovement.deleteMany({});
    console.log(`  ✅ InventoryMovements: ${r1.count}`);

    const r2 = await prisma.rewardApplication.deleteMany({});
    console.log(`  ✅ RewardApplications: ${r2.count}`);

    const r3 = await prisma.clientCredit.deleteMany({});
    console.log(`  ✅ ClientCredits: ${r3.count}`);

    const r4 = await prisma.clientAccount.deleteMany({});
    console.log(`  ✅ ClientAccounts: ${r4.count}`);

    const r5 = await prisma.financialRecord.deleteMany({});
    console.log(`  ✅ FinancialRecords: ${r5.count}`);

    const r6 = await prisma.orderPayment.deleteMany({});
    console.log(`  ✅ OrderPayments: ${r6.count}`);

    const r7 = await prisma.orderItem.deleteMany({});
    console.log(`  ✅ OrderItems: ${r7.count}`);

    const r8 = await prisma.call.deleteMany({});
    console.log(`  ✅ Calls: ${r8.count}`);

    const r9 = await prisma.order.deleteMany({});
    console.log(`  ✅ Orders: ${r9.count}`);

    const r10 = await prisma.receptionBatch.deleteMany({});
    console.log(`  ✅ ReceptionBatches: ${r10.count}`);

    const r11 = await prisma.cashClosure.deleteMany({});
    console.log(`  ✅ CashClosures: ${r11.count}`);

    // Reset bank account balances to 0
    const r12 = await prisma.bankAccount.updateMany({
      data: { currentBalance: 0 }
    });
    console.log(`  ✅ BankAccounts reseteadas: ${r12.count}`);

    console.log('\n✅ Limpieza completada');
    console.log('Preservados: clientes, marcas, cuentas bancarias, usuarios\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

clean();
