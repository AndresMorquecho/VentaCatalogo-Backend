/**
 * SCRIPT DE SOLO LECTURA - Conteo de referencias de username antiguo
 * NO MODIFICA NADA - Solo cuenta registros afectados
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

async function countReferences(old: string, newName: string) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 CONTEO PARA: "${old}" → "${newName}"`);
  console.log(`${'='.repeat(70)}`);

  // First verify the user exists with the new username
  const user = await prisma.user.findFirst({
    where: { username: newName },
    select: { id: true, username: true, role: true }
  });
  
  if (user) {
    console.log(`✅ Usuario encontrado con nuevo nombre: ${user.username} (id: ${user.id}, role: ${user.role})`);
  } else {
    console.log(`⚠️  NO se encontró usuario con username "${newName}" - verificar si ya se cambió`);
  }

  // Also check if old username still exists (shouldn't)
  const oldUser = await prisma.user.findFirst({
    where: { username: old },
    select: { id: true, username: true }
  });
  if (oldUser) {
    console.log(`⚠️  ATENCIÓN: Aún existe un usuario con el nombre antiguo "${old}" (id: ${oldUser.id})`);
  }

  const counts: { tabla: string; campo: string; count: number }[] = [];

  // 1. financial_records.created_by
  counts.push({
    tabla: 'financial_records',
    campo: 'created_by',
    count: await prisma.financialRecord.count({ where: { createdBy: old } })
  });

  // 2. orders.created_by_name
  counts.push({
    tabla: 'orders',
    campo: 'created_by_name',
    count: await prisma.order.count({ where: { createdByName: old } })
  });

  // 3. orders.received_by_name
  counts.push({
    tabla: 'orders',
    campo: 'received_by_name',
    count: await prisma.order.count({ where: { receivedByName: old } })
  });

  // 4. orders.delivered_by_name
  counts.push({
    tabla: 'orders',
    campo: 'delivered_by_name',
    count: await prisma.order.count({ where: { deliveredByName: old } })
  });

  // 5. cash_closures.closed_by
  counts.push({
    tabla: 'cash_closures',
    campo: 'closed_by',
    count: await prisma.cashClosure.count({ where: { closedBy: old } })
  });

  // 6. reception_batches.received_by_name
  counts.push({
    tabla: 'reception_batches',
    campo: 'received_by_name',
    count: await prisma.receptionBatch.count({ where: { receivedByName: old } })
  });

  // 7. delivery_batches.delivered_by_name
  counts.push({
    tabla: 'delivery_batches',
    campo: 'delivered_by_name',
    count: await prisma.deliveryBatch.count({ where: { deliveredByName: old } })
  });

  // 8. wallet_recharges.created_by_name
  counts.push({
    tabla: 'wallet_recharges',
    campo: 'created_by_name',
    count: await prisma.walletRecharge.count({ where: { createdByName: old } })
  });

  // 9. wallet_recharges.validated_by_name
  counts.push({
    tabla: 'wallet_recharges',
    campo: 'validated_by_name',
    count: await prisma.walletRecharge.count({ where: { validatedByName: old } })
  });

  // 10. audit_logs.user_name
  counts.push({
    tabla: 'audit_logs',
    campo: 'user_name',
    count: await prisma.auditLog.count({ where: { userName: old } })
  });

  // 11. catalog_deliveries.delivered_by
  counts.push({
    tabla: 'catalog_deliveries',
    campo: 'delivered_by',
    count: await prisma.catalogDelivery.count({ where: { deliveredBy: old } })
  });

  // 12. catalog_inventories.created_by
  counts.push({
    tabla: 'catalog_inventories',
    campo: 'created_by',
    count: await prisma.catalogInventory.count({ where: { createdBy: old } })
  });

  // 13. calls.created_by
  counts.push({
    tabla: 'calls',
    campo: 'created_by',
    count: await prisma.call.count({ where: { createdBy: old } })
  });

  // 14. calls.updated_by
  counts.push({
    tabla: 'calls',
    campo: 'updated_by',
    count: await prisma.call.count({ where: { updatedBy: old } })
  });

  // 15. inventory_movements.created_by
  counts.push({
    tabla: 'inventory_movements',
    campo: 'created_by',
    count: await prisma.inventoryMovement.count({ where: { createdBy: old } })
  });

  // 16. clients.created_by_name
  counts.push({
    tabla: 'clients',
    campo: 'created_by_name',
    count: await prisma.client.count({ where: { createdByName: old } })
  });

  // 17. order_receipts.created_by_name
  counts.push({
    tabla: 'order_receipts',
    campo: 'created_by_name',
    count: await prisma.orderReceipt.count({ where: { createdByName: old } })
  });

  // 18. exchange_batches.created_by_name
  counts.push({
    tabla: 'exchange_batches',
    campo: 'created_by_name',
    count: await prisma.exchangeBatch.count({ where: { createdByName: old } })
  });

  // 19. note_templates.created_by_name
  counts.push({
    tabla: 'note_templates',
    campo: 'created_by_name',
    count: await prisma.noteTemplate.count({ where: { createdByName: old } })
  });

  // 20. system_settings.updated_by_name
  counts.push({
    tabla: 'system_settings',
    campo: 'updated_by_name',
    count: await prisma.systemSettings.count({ where: { updatedByName: old } })
  });

  // 21. system_locks.user_name
  counts.push({
    tabla: 'system_locks',
    campo: 'user_name',
    count: await prisma.systemLock.count({ where: { userName: old } })
  });

  // Print results
  let totalRecords = 0;
  console.log(`\n  ${'Tabla'.padEnd(25)} | ${'Campo'.padEnd(22)} | Registros`);
  console.log(`  ${'-'.repeat(25)}-+-${'-'.repeat(22)}-+-${'-'.repeat(10)}`);
  
  for (const c of counts) {
    const marker = c.count > 0 ? '⚡' : '  ';
    console.log(`${marker}${c.tabla.padEnd(25)} | ${c.campo.padEnd(22)} | ${c.count}`);
    totalRecords += c.count;
  }

  console.log(`\n  📊 TOTAL registros con "${old}": ${totalRecords}`);
  
  return totalRecords;
}

async function main() {
  console.log('🔍 SCRIPT DE CONTEO - SOLO LECTURA (NO MODIFICA NADA)');
  console.log(`📅 Fecha: ${new Date().toISOString()}`);
  
  let grandTotal = 0;

  for (const m of mappings) {
    grandTotal += await countReferences(m.oldUsername, m.newUsername);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 GRAN TOTAL de registros que se actualizarían: ${grandTotal}`);
  console.log(`${'='.repeat(70)}`);
  
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
