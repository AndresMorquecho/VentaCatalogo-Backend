import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function backup() {
  const actionsPath = path.join(__dirname, '../scratch/migration_actions.json');
  if (!fs.existsSync(actionsPath)) {
    console.error("Migration actions not found. Run analysis first.");
    return;
  }

  const actions = JSON.parse(fs.readFileSync(actionsPath, 'utf-8'));
  const orderIds = actions.map((a: any) => a.id);

  console.log(`Generating backup for ${orderIds.length} orders...`);

  const backupData = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: {
      payments: true,
      items: true
    }
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(__dirname, `../scratch/migration_backup_${timestamp}.json`);
  
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));

  console.log(`Backup saved to ${backupPath}`);
  console.log(`Ready for migration.`);
}

backup()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
