import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function analyze() {
  const legacyDataPath = path.join(__dirname, '../scratch/legacy_orders.json');
  if (!fs.existsSync(legacyDataPath)) {
    console.error("Legacy data not found at", legacyDataPath);
    return;
  }

  const legacyOrders: any[] = JSON.parse(fs.readFileSync(legacyDataPath, 'utf-8'));
  const report: any[] = [];
  
  console.log(`Analyzing ${legacyOrders.length} legacy orders (Optimized & Deduplicated)...`);

  const receiptNumbers = legacyOrders.map(l => l.receiptNumber);
  const orderNumbers = legacyOrders.map(l => l.orderNumber).filter(n => n && n !== 'nan');

  const dbOrders = await prisma.order.findMany({
    where: {
      OR: [
        { receiptNumber: { in: receiptNumbers } },
        { orderNumber: { in: orderNumbers } }
      ]
    },
    include: {
      payments: true
    }
  });

  console.log(`Found ${dbOrders.length} potential orders in DB matching criteria.`);

  let needsUpdate = 0;
  const processedOrderIds = new Set<string>();

  for (const order of dbOrders) {
    if (processedOrderIds.has(order.id)) continue;

    // Find the best legacy match for this order
    const legacy = legacyOrders.find(l => 
      l.receiptNumber === order.receiptNumber || 
      (l.orderNumber && l.orderNumber === order.orderNumber)
    );

    if (!legacy) continue;

    const currentPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const currentTotal = Number(order.realInvoiceTotal || order.total);
    const currentPending = Math.max(0, currentTotal - currentPaid);
    const isSystemPending = currentPending > 0.01;

    const actions: string[] = [];
    
    if (legacy.received && order.status === 'POR_RECIBIR') {
      actions.push("Change status to RECIBIDO_EN_BODEGA");
    }
    if (legacy.received && !order.receptionBatchId) {
      actions.push("Assign to Reception Batch (Legacy)");
    }

    if (legacy.delivered && order.status !== 'ENTREGADO') {
      actions.push("Change status to ENTREGADO");
    }
    if (legacy.delivered && !order.deliveryBatchId) {
      actions.push("Assign to Delivery Batch (Legacy)");
    }

    if (isSystemPending) {
      actions.push(`Adjust total to match payments ($${currentPaid.toFixed(2)}) to mark as PAID`);
    }

    if (actions.length > 0) {
      needsUpdate++;
      report.push({
        id: order.id,
        receiptNumber: order.receiptNumber,
        orderNumber: order.orderNumber,
        clientName: order.clientName,
        currentStatus: order.status,
        currentPending: currentPending.toFixed(2),
        legacyReceived: legacy.received,
        legacyDelivered: legacy.delivered,
        actions,
        proposedTotal: currentPaid
      });
      processedOrderIds.add(order.id);
    }
  }

  const jsonReportPath = path.join(__dirname, '../scratch/migration_actions.json');
  fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2));

  console.log(`Analysis complete. Found ${needsUpdate} orders requiring updates. Results saved to ${jsonReportPath}`);
}

analyze()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
