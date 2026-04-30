import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function execute() {
  const actionsPath = path.join(__dirname, '../scratch/migration_actions.json');
  if (!fs.existsSync(actionsPath)) {
    console.error("Migration actions not found. Run analysis first.");
    return;
  }

  const actions: any[] = JSON.parse(fs.readFileSync(actionsPath, 'utf-8'));
  console.log(`Resuming/Starting migration for ${actions.length} orders...`);

  // 1. Create or get migration batches
  await prisma.receptionBatch.upsert({
    where: { packingNumber: 'LEGACY' },
    update: {},
    create: {
      packingNumber: 'LEGACY',
      packingTotal: 0,
      receptionDate: new Date(),
      receivedByName: 'Antigravity-Migration',
      notes: 'Lote de regularización masiva post-importación Excel'
    }
  });
  const recBatch = await prisma.receptionBatch.findUnique({ where: { packingNumber: 'LEGACY' } });

  await prisma.deliveryBatch.upsert({
    where: { deliveryNumber: 'LEGACY' },
    update: {},
    create: {
      deliveryNumber: 'LEGACY',
      deliveryDate: new Date(),
      deliveredByName: 'Antigravity-Migration',
      notes: 'Lote de regularización masiva post-importación Excel'
    }
  });
  const delBatch = await prisma.deliveryBatch.findUnique({ where: { deliveryNumber: 'LEGACY' } });

  if (!recBatch || !delBatch) throw new Error("Could not create batches");

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const action of actions) {
    try {
      // Check if already updated (idempotency)
      const currentOrder = await prisma.order.findUnique({ 
        where: { id: action.id }, 
        select: { notes: true, status: true, total: true, realInvoiceTotal: true, receptionBatchId: true, deliveryBatchId: true } 
      });

      if (!currentOrder) {
        skippedCount++;
        continue;
      }

      // If the order already has the migration note, skip it
      if (currentOrder.notes?.includes("[MIGRACION LEGACY 30-04-2026]")) {
        skippedCount++;
        continue;
      }

      const updateData: any = {
        version: { increment: 1 },
        updatedAt: new Date()
      };

      const migrationNote = `[MIGRACION LEGACY 30-04-2026] Regularización de estados y saldos.`;
      updateData.notes = currentOrder.notes ? `${currentOrder.notes}\n${migrationNote}` : migrationNote;

      if (action.actions.includes("Change status to RECIBIDO_EN_BODEGA")) {
        updateData.status = 'RECIBIDO_EN_BODEGA';
        updateData.receptionDate = new Date();
        updateData.receivedByName = 'Antigravity-Migration';
      }
      if (action.actions.includes("Assign to Reception Batch (Legacy)")) {
        updateData.receptionBatchId = recBatch.id;
        updateData.packingNumber = 'LEGACY';
      }

      if (action.actions.includes("Change status to ENTREGADO")) {
        updateData.status = 'ENTREGADO';
        updateData.deliveryDate = new Date();
        updateData.deliveredByName = 'Antigravity-Migration';
      }
      if (action.actions.includes("Assign to Delivery Batch (Legacy)")) {
        updateData.deliveryBatchId = delBatch.id;
        updateData.deliveryNumber = 'LEGACY';
      }

      if (action.actions.some((a: string) => a.includes("Adjust total"))) {
        updateData.realInvoiceTotal = action.proposedTotal;
        updateData.total = action.proposedTotal;
      }

      await prisma.order.update({
        where: { id: action.id },
        data: updateData
      });
      
      successCount++;
      if (successCount % 50 === 0) console.log(`Progress: ${successCount} updated, ${skippedCount} skipped...`);

    } catch (err) {
      console.error(`Error updating order ${action.receiptNumber}:`, err);
      errorCount++;
    }
  }

  console.log(`Migration complete!`);
  console.log(`- Success: ${successCount}`);
  console.log(`- Skipped (Already done): ${skippedCount}`);
  console.log(`- Errors: ${errorCount}`);
}

execute()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
