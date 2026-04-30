import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function analyze() {
  const targetPath = path.join(__dirname, '../scratch/target_receipts.json');
  const receipts: string[] = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));

  console.log(`Analyzing ${receipts.length} target receipts from DB...`);

  const dbOrders = await prisma.order.findMany({
    where: {
      receiptNumber: { in: receipts }
    },
    include: {
      payments: true
    }
  });

  const foundReceipts = new Set(dbOrders.map(o => o.receiptNumber));
  const missing = receipts.filter(r => !foundReceipts.has(r));

  const report = {
    totalTarget: receipts.length,
    foundInDB: dbOrders.length,
    missingInDB: missing.length,
    byStatus: {} as Record<string, number>,
    pendingPaymentCount: 0,
    totalPendingAmount: 0,
    examples: [] as any[]
  };

  for (const order of dbOrders) {
    report.byStatus[order.status] = (report.byStatus[order.status] || 0) + 1;
    
    const paid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const total = Number(order.realInvoiceTotal || order.total);
    const pending = Math.max(0, total - paid);

    if (pending > 0.01) {
      report.pendingPaymentCount++;
      report.totalPendingAmount += pending;
    }

    if (report.examples.length < 10 && pending > 0) {
      report.examples.push({
        receipt: order.receiptNumber,
        client: order.clientName,
        status: order.status,
        total: total.toFixed(2),
        paid: paid.toFixed(2),
        pending: pending.toFixed(2)
      });
    }
  }

  const resultsPath = path.join(__dirname, '../scratch/new_analysis_results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(report, null, 2));
  console.log(`Analysis complete. Found ${dbOrders.length} orders.`);
}

analyze()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
