import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fullFactoryReset() {
  console.log('🔥 Iniciando Limpieza PROFUNDA de la Base de Datos...');
  console.log('🎯 Objetivo: Eliminar todas las transacciones y resetear los consecutivos a 1.\n');

  try {
    // Definimos las tablas transaccionales en orden de dependencias o usamos CASCADE
    // Usaremos TRUNCATE con RESTART IDENTITY para asegurar que cualquier secuencia de BD vuelva a 1
    const tablesToTruncate = [
      'order_items',
      'order_payments',
      'financial_records',
      'inventory_movements',
      'reward_applications',
      'client_credits',
      'wallet_recharges',
      'calls',
      'loyalty_redemptions',
      'catalog_deliveries',
      'catalog_inventories',
      'exchange_batch_items',
      'order_exchange_items',
      'order_exchanges',
      'exchange_batches',
      'reception_batches',
      'delivery_batches',
      'orders',
      'order_receipts',
      'audit_logs',
      'system_locks',
      'processing_requests',
      'cash_closures',
      'system_settings' // Aquí se guardan los contadores manuales
    ];

    console.log('🧹 Vaciando tablas transaccionales...');
    for (const table of tablesToTruncate) {
        try {
            await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
            console.log(`  ✅ ${table} truncada y secuencia reiniciada.`);
        } catch (e: any) {
            console.warn(`  ⚠️  Error al truncar ${table}: ${e.message}`);
        }
    }

    console.log('\n💰 Reiniciando estados financieros...');
    
    // 1. Cuentas bancarias a 0
    await prisma.bankAccount.updateMany({
      data: { currentBalance: 0 }
    });
    console.log('  ✅ Saldos de cuentas bancarias reseteados a $0.');

    // 2. Cuentas de clientes a 0
    await prisma.clientAccount.updateMany({
      data: {
        totalCreditAvailable: 0,
        totalRewardPoints: 0,
        totalOrders: 0,
        totalSpent: 0,
        rewardLevel: 'BRONCE'
      }
    });
    console.log('  ✅ Estadísticas y billeteras de clientes reseteadas.');

    // 3. Limpiar metadata de actividad en clientes
    await prisma.client.updateMany({
      data: {
        lastOrderDate: null,
        lastBrandName: null,
        lastDataUpdate: new Date()
      }
    });
    console.log('  ✅ Fechas de última actividad en clientes limpiadas.');

    console.log('\n================================================');
    console.log('  ✨ LIMPIEZA COMPLETADA EXITOSAMENTE ✨');
    console.log('================================================');
    console.log('Preservados: Usuarios, Roles, Clientes, Marcas, Configuración de Tipos y Canales.');
    console.log('Consecutivos: Todos los recibos y lotes comenzarán desde el número 001.');

  } catch (error) {
    console.error('\n❌ ERROR FATAL durante la limpieza:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fullFactoryReset();
