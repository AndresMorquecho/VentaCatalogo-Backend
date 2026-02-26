/**
 * Script para ejecutar la limpieza de base de datos
 * Elimina TODO excepto: Clientes, Bancos y Marcas
 * 
 * Uso:
 *   node backend/prisma/run-clean.js
 * 
 * O desde el directorio backend:
 *   node prisma/run-clean.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const prisma = new PrismaClient();

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function cleanDatabase() {
  try {
    log('\n============================================', 'cyan');
    log('  LIMPIEZA DE BASE DE DATOS', 'cyan');
    log('============================================', 'cyan');
    log('\n⚠️  ADVERTENCIA: Esta operación es IRREVERSIBLE', 'yellow');
    log('Se eliminarán TODOS los datos excepto:', 'yellow');
    log('  ✓ Clientes', 'green');
    log('  ✓ Marcas', 'green');
    log('  ✓ Cuentas Bancarias (balance reseteado a 0)', 'green');
    log('  ✓ Usuarios (para poder hacer login)', 'green');
    log('\nSe eliminarán:', 'red');
    log('  ✗ Todas las órdenes', 'red');
    log('  ✗ Todos los pagos', 'red');
    log('  ✗ Todos los registros financieros', 'red');
    log('  ✗ Todos los movimientos de inventario', 'red');
    log('  ✗ Todas las llamadas', 'red');
    log('  ✗ Todas las cuentas de clientes', 'red');
    log('  ✗ Todos los créditos', 'red');
    log('  ✗ Todos los cierres de caja', 'red');
    log('  ✗ Todas las reglas de lealtad', 'red');

    const answer = await askQuestion('\n¿Está seguro que desea continuar? (escriba "SI" para confirmar): ');

    if (answer.toUpperCase() !== 'SI') {
      log('\n❌ Operación cancelada por el usuario', 'yellow');
      process.exit(0);
    }

    log('\n🔄 Iniciando limpieza...', 'blue');

    // Contar registros antes de eliminar
    log('\n📊 Contando registros actuales...', 'blue');
    const beforeCounts = {
      clients: await prisma.client.count(),
      brands: await prisma.brand.count(),
      bankAccounts: await prisma.bankAccount.count(),
      orders: await prisma.order.count(),
      orderItems: await prisma.orderItem.count(),
      orderPayments: await prisma.orderPayment.count(),
      financialRecords: await prisma.financialRecord.count(),
      clientAccounts: await prisma.clientAccount.count(),
      clientCredits: await prisma.clientCredit.count(),
      rewardApplications: await prisma.rewardApplication.count(),
      inventoryMovements: await prisma.inventoryMovement.count(),
      cashClosures: await prisma.cashClosure.count(),
      calls: await prisma.call.count(),
      users: await prisma.user.count(),
      loyaltyRules: await prisma.loyaltyRule.count(),
      loyaltyPrizes: await prisma.loyaltyPrize.count(),
    };

    log('\nRegistros actuales:', 'cyan');
    log(`  Clientes: ${beforeCounts.clients}`, 'green');
    log(`  Marcas: ${beforeCounts.brands}`, 'green');
    log(`  Cuentas bancarias: ${beforeCounts.bankAccounts}`, 'green');
    log(`  Órdenes: ${beforeCounts.orders}`, 'yellow');
    log(`  Registros financieros: ${beforeCounts.financialRecords}`, 'yellow');
    log(`  Llamadas: ${beforeCounts.calls}`, 'yellow');

    // Ejecutar eliminaciones en orden correcto
    log('\n🗑️  Eliminando datos...', 'blue');

    // 1. Usuarios (PRESERVADOS - comentado)
    // log('  → Eliminando usuarios...', 'yellow');
    // await prisma.user.deleteMany({});

    // 2. Reglas de lealtad y premios
    log('  → Eliminando reglas de lealtad...', 'yellow');
    await prisma.loyaltyRule.deleteMany({});
    await prisma.loyaltyPrize.deleteMany({});

    // 3. Cierres de caja
    log('  → Eliminando cierres de caja...', 'yellow');
    await prisma.cashClosure.deleteMany({});

    // 4. Llamadas
    log('  → Eliminando llamadas...', 'yellow');
    await prisma.call.deleteMany({});

    // 5. Movimientos de inventario
    log('  → Eliminando movimientos de inventario...', 'yellow');
    await prisma.inventoryMovement.deleteMany({});

    // 6. Aplicaciones de recompensas
    log('  → Eliminando aplicaciones de recompensas...', 'yellow');
    await prisma.rewardApplication.deleteMany({});

    // 7. Créditos de clientes
    log('  → Eliminando créditos de clientes...', 'yellow');
    await prisma.clientCredit.deleteMany({});

    // 8. Cuentas de clientes
    log('  → Eliminando cuentas de clientes...', 'yellow');
    await prisma.clientAccount.deleteMany({});

    // 9. Registros financieros
    log('  → Eliminando registros financieros...', 'yellow');
    await prisma.financialRecord.deleteMany({});

    // 9.1. Resetear cuentas bancarias a 0
    log('  → Reseteando cuentas bancarias a 0...', 'yellow');
    await prisma.bankAccount.updateMany({
      data: { balance: 0 }
    });

    // 10. Pagos de órdenes
    log('  → Eliminando pagos de órdenes...', 'yellow');
    await prisma.orderPayment.deleteMany({});

    // 11. Items de órdenes
    log('  → Eliminando items de órdenes...', 'yellow');
    await prisma.orderItem.deleteMany({});

    // 12. Órdenes
    log('  → Eliminando órdenes...', 'yellow');
    await prisma.order.deleteMany({});

    // Contar registros después de eliminar
    log('\n📊 Verificando limpieza...', 'blue');
    const afterCounts = {
      clients: await prisma.client.count(),
      brands: await prisma.brand.count(),
      bankAccounts: await prisma.bankAccount.count(),
      orders: await prisma.order.count(),
      financialRecords: await prisma.financialRecord.count(),
    };

    log('\n============================================', 'green');
    log('  ✅ LIMPIEZA COMPLETADA EXITOSAMENTE', 'green');
    log('============================================', 'green');
    log('\nRegistros preservados:', 'cyan');
    log(`  ✓ Clientes: ${afterCounts.clients}`, 'green');
    log(`  ✓ Marcas: ${afterCounts.brands}`, 'green');
    log(`  ✓ Cuentas bancarias (balance en 0): ${afterCounts.bankAccounts}`, 'green');
    log(`  ✓ Usuarios: ${beforeCounts.users}`, 'green');
    log('\nRegistros eliminados:', 'cyan');
    log(`  ✗ Órdenes: ${beforeCounts.orders} → ${afterCounts.orders}`, 'red');
    log(`  ✗ Registros financieros: ${beforeCounts.financialRecords} → ${afterCounts.financialRecords}`, 'red');
    log(`  ✗ Items de órdenes: ${beforeCounts.orderItems}`, 'red');
    log(`  ✗ Pagos: ${beforeCounts.orderPayments}`, 'red');
    log(`  ✗ Llamadas: ${beforeCounts.calls}`, 'red');
    log(`  ✗ Movimientos de inventario: ${beforeCounts.inventoryMovements}`, 'red');
    log(`  ✗ Cuentas de clientes: ${beforeCounts.clientAccounts}`, 'red');
    log(`  ✗ Créditos: ${beforeCounts.clientCredits}`, 'red');
    log('============================================\n', 'green');

  } catch (error) {
    log('\n❌ ERROR durante la limpieza:', 'red');
    log(error.message, 'red');
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
cleanDatabase();
