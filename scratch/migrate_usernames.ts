/**
 * SCRIPT DE MIGRACIÓN TRANSACCIONAL
 * Propaga los usernames antiguos → nuevos en TODAS las tablas
 * Si falla cualquier paso, se revierte TODO automáticamente
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface UsernameMapping {
  oldUsername: string;
  newUsername: string;
}

const mappings: UsernameMapping[] = [
  { oldUsername: 'blanca_azucena_tomala__bravo', newUsername: 'BATB' },
  { oldUsername: 'diego_david_carrillo_andrade', newUsername: 'DDCA' },
];

async function migrateUsername(oldName: string, newName: string) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔄 MIGRANDO: "${oldName}" → "${newName}"`);
  console.log(`${'='.repeat(70)}`);

  const result = await prisma.$transaction(async (tx) => {
    const results: { tabla: string; campo: string; updated: number }[] = [];

    // 1. financial_records.created_by
    const r1 = await tx.financialRecord.updateMany({ where: { createdBy: oldName }, data: { createdBy: newName } });
    results.push({ tabla: 'financial_records', campo: 'created_by', updated: r1.count });

    // 2. orders.created_by_name
    const r2 = await tx.order.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } });
    results.push({ tabla: 'orders', campo: 'created_by_name', updated: r2.count });

    // 3. orders.received_by_name
    const r3 = await tx.order.updateMany({ where: { receivedByName: oldName }, data: { receivedByName: newName } });
    results.push({ tabla: 'orders', campo: 'received_by_name', updated: r3.count });

    // 4. orders.delivered_by_name
    const r4 = await tx.order.updateMany({ where: { deliveredByName: oldName }, data: { deliveredByName: newName } });
    results.push({ tabla: 'orders', campo: 'delivered_by_name', updated: r4.count });

    // 5. cash_closures.closed_by
    const r5 = await tx.cashClosure.updateMany({ where: { closedBy: oldName }, data: { closedBy: newName } });
    results.push({ tabla: 'cash_closures', campo: 'closed_by', updated: r5.count });

    // 6. reception_batches.received_by_name
    const r6 = await tx.receptionBatch.updateMany({ where: { receivedByName: oldName }, data: { receivedByName: newName } });
    results.push({ tabla: 'reception_batches', campo: 'received_by_name', updated: r6.count });

    // 7. delivery_batches.delivered_by_name
    const r7 = await tx.deliveryBatch.updateMany({ where: { deliveredByName: oldName }, data: { deliveredByName: newName } });
    results.push({ tabla: 'delivery_batches', campo: 'delivered_by_name', updated: r7.count });

    // 8. wallet_recharges.created_by_name
    const r8 = await tx.walletRecharge.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } });
    results.push({ tabla: 'wallet_recharges', campo: 'created_by_name', updated: r8.count });

    // 9. wallet_recharges.validated_by_name
    const r9 = await tx.walletRecharge.updateMany({ where: { validatedByName: oldName }, data: { validatedByName: newName } });
    results.push({ tabla: 'wallet_recharges', campo: 'validated_by_name', updated: r9.count });

    // 10. audit_logs.user_name
    const r10 = await tx.auditLog.updateMany({ where: { userName: oldName }, data: { userName: newName } });
    results.push({ tabla: 'audit_logs', campo: 'user_name', updated: r10.count });

    // 11. catalog_deliveries.delivered_by
    const r11 = await tx.catalogDelivery.updateMany({ where: { deliveredBy: oldName }, data: { deliveredBy: newName } });
    results.push({ tabla: 'catalog_deliveries', campo: 'delivered_by', updated: r11.count });

    // 12. catalog_inventories.created_by
    const r12 = await tx.catalogInventory.updateMany({ where: { createdBy: oldName }, data: { createdBy: newName } });
    results.push({ tabla: 'catalog_inventories', campo: 'created_by', updated: r12.count });

    // 13. calls.created_by
    const r13 = await tx.call.updateMany({ where: { createdBy: oldName }, data: { createdBy: newName } });
    results.push({ tabla: 'calls', campo: 'created_by', updated: r13.count });

    // 14. calls.updated_by
    const r14 = await tx.call.updateMany({ where: { updatedBy: oldName }, data: { updatedBy: newName } });
    results.push({ tabla: 'calls', campo: 'updated_by', updated: r14.count });

    // 15. inventory_movements.created_by
    const r15 = await tx.inventoryMovement.updateMany({ where: { createdBy: oldName }, data: { createdBy: newName } });
    results.push({ tabla: 'inventory_movements', campo: 'created_by', updated: r15.count });

    // 16. clients.created_by_name
    const r16 = await tx.client.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } });
    results.push({ tabla: 'clients', campo: 'created_by_name', updated: r16.count });

    // 17. order_receipts.created_by_name
    const r17 = await tx.orderReceipt.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } });
    results.push({ tabla: 'order_receipts', campo: 'created_by_name', updated: r17.count });

    // 18. exchange_batches.created_by_name
    const r18 = await tx.exchangeBatch.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } });
    results.push({ tabla: 'exchange_batches', campo: 'created_by_name', updated: r18.count });

    // 19. note_templates.created_by_name
    const r19 = await tx.noteTemplate.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } });
    results.push({ tabla: 'note_templates', campo: 'created_by_name', updated: r19.count });

    // 20. system_settings.updated_by_name
    const r20 = await tx.systemSettings.updateMany({ where: { updatedByName: oldName }, data: { updatedByName: newName } });
    results.push({ tabla: 'system_settings', campo: 'updated_by_name', updated: r20.count });

    // 21. system_locks.user_name
    const r21 = await tx.systemLock.updateMany({ where: { userName: oldName }, data: { userName: newName } });
    results.push({ tabla: 'system_locks', campo: 'user_name', updated: r21.count });

    return results;
  }, { timeout: 60000 }); // 60s timeout

  // Print results
  let total = 0;
  console.log(`\n  ${'Tabla'.padEnd(25)} | ${'Campo'.padEnd(22)} | Actualizados`);
  console.log(`  ${'-'.repeat(25)}-+-${'-'.repeat(22)}-+-${'-'.repeat(12)}`);
  
  for (const r of result) {
    const marker = r.updated > 0 ? '✅' : '  ';
    console.log(`${marker}${r.tabla.padEnd(25)} | ${r.campo.padEnd(22)} | ${r.updated}`);
    total += r.updated;
  }

  console.log(`\n  ✅ TOTAL registros actualizados para "${oldName}": ${total}`);
  return total;
}

async function main() {
  console.log('🚀 SCRIPT DE MIGRACIÓN TRANSACCIONAL');
  console.log(`📅 Fecha: ${new Date().toISOString()}`);
  console.log('⚡ Si falla cualquier paso, se revierte TODO automáticamente\n');

  let grandTotal = 0;

  for (const m of mappings) {
    try {
      grandTotal += await migrateUsername(m.oldUsername, m.newUsername);
    } catch (error) {
      console.error(`\n❌ ERROR en migración "${m.oldUsername}" → "${m.newUsername}":`);
      console.error(error);
      console.error('⚠️  Toda la transacción para este usuario fue REVERTIDA. No se modificó nada.');
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`✅ MIGRACIÓN COMPLETADA: ${grandTotal} registros actualizados en total`);
  console.log(`${'='.repeat(70)}`);

  // VERIFICATION: Re-run counts to confirm zero remaining
  console.log('\n🔍 VERIFICACIÓN POST-MIGRACIÓN:');
  for (const m of mappings) {
    const remaining = await prisma.financialRecord.count({ where: { createdBy: m.oldUsername } });
    const ordersRemaining = await prisma.order.count({
      where: {
        OR: [
          { createdByName: m.oldUsername },
          { receivedByName: m.oldUsername },
          { deliveredByName: m.oldUsername }
        ]
      }
    });
    console.log(`  "${m.oldUsername}": financial_records=${remaining}, orders=${ordersRemaining} ${remaining === 0 && ordersRemaining === 0 ? '✅ LIMPIO' : '⚠️ REVISAR'}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Error fatal:', e);
  await prisma.$disconnect();
  process.exit(1);
});
