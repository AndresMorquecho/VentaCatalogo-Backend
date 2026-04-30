import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function rollback() {
  const backupFile = 'migration_backup_2026-04-30T18-58-11-626Z.json';
  const backupPath = path.join(__dirname, '../scratch/', backupFile);
  
  if (!fs.existsSync(backupPath)) {
    console.error("Backup file not found at", backupPath);
    return;
  }

  const backupData: any[] = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
  console.log(`Starting rollback for ${backupData.length} orders from backup...`);

  let restoredCount = 0;
  let errorCount = 0;

  for (const original of backupData) {
    try {
      // Restore the fields exactly as they were
      await prisma.order.update({
        where: { id: original.id },
        data: {
          status: original.status,
          total: original.total,
          realInvoiceTotal: original.realInvoiceTotal,
          receptionDate: original.receptionDate ? new Date(original.receptionDate) : null,
          deliveryDate: original.deliveryDate ? new Date(original.deliveryDate) : null,
          receptionBatchId: original.receptionBatchId,
          deliveryBatchId: original.deliveryBatchId,
          packingNumber: original.packingNumber,
          deliveryNumber: original.deliveryNumber,
          notes: original.notes,
          receivedByName: original.receivedByName,
          deliveredByName: original.deliveredByName,
          version: { increment: 1 },
          updatedAt: new Date()
        }
      });
      restoredCount++;
      if (restoredCount % 50 === 0) console.log(`Rollback progress: ${restoredCount} restored...`);
    } catch (err) {
      console.error(`Error restoring order ${original.receiptNumber}:`, err);
      errorCount++;
    }
  }

  console.log(`Rollback complete!`);
  console.log(`- Restored: ${restoredCount}`);
  console.log(`- Errors: ${errorCount}`);
}

rollback()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
