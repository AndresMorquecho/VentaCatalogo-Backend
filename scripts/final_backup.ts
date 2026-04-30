import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function backup() {
  const targetPath = path.join(__dirname, '../scratch/target_receipts.json');
  const receipts: string[] = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));

  console.log(`Generating backup for ${receipts.length} receipts...`);

  const backupData = await prisma.order.findMany({
    where: { receiptNumber: { in: receipts } },
    include: {
      payments: true,
      financialRecords: true
    }
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(__dirname, `../scratch/final_migration_backup_${timestamp}.json`);
  
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));

  console.log(`Backup saved to ${backupPath}. Total orders: ${backupData.length}`);
}

backup()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
