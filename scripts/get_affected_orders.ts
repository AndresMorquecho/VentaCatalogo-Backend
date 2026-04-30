import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function getAffected() {
  console.log("Fetching affected orders...");
  const affected = await prisma.order.findMany({
    where: {
      notes: { contains: "[MIGRACION LEGACY 30-04-2026]" }
    },
    select: {
      receiptNumber: true,
      orderNumber: true,
      clientName: true,
      status: true,
      total: true,
      notes: true
    }
  });

  const reportPath = path.join(__dirname, '../scratch/affected_orders.json');
  fs.writeFileSync(reportPath, JSON.stringify(affected, null, 2));
  console.log(`Found ${affected.length} affected orders. List saved to ${reportPath}`);
}

getAffected()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
