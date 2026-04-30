import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function findExtraOrders() {
  const targetPath = path.join(__dirname, '../scratch/target_receipts.json');
  const receipts: string[] = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));

  const orders = await prisma.order.findMany({
    where: { receiptNumber: { in: receipts } },
    select: {
      id: true,
      receiptNumber: true,
      orderNumber: true,
      clientName: true,
      brandId: true,
      total: true
    }
  });

  const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
  const brandMap = Object.fromEntries(brands.map(b => [b.id, b.name]));

  const processedReceipts = new Set();
  const extraOrders = [];

  // We sort to be consistent
  orders.sort((a, b) => a.receiptNumber.localeCompare(b.receiptNumber));

  for (const o of orders) {
    if (processedReceipts.has(o.receiptNumber)) {
      // This is one of the "extra" orders that contributed to the 1597 count
      extraOrders.push(o);
    } else {
      processedReceipts.add(o.receiptNumber);
    }
  }

  let md = "# Reporte de las 89 Órdenes 'Extra' (Multi-Pedido)\n\n";
  md += `Esta lista contiene las 89 órdenes adicionales que fueron procesadas porque comparten el número de recibo con otra orden principal de la lista de 1,508.\n\n`;

  md += "| Recibo | Pedido Extra | Cliente | Marca | Total |\n";
  md += "| --- | --- | --- | --- | --- |\n";

  for (const o of extraOrders) {
    md += `| ${o.receiptNumber} | ${o.orderNumber || '-'} | ${o.clientName} | ${brandMap[o.brandId] || 'Desconocida'} | $${Number(o.total).toFixed(2)} |\n`;
  }

  const reportPath = path.join(__dirname, '../scratch/extra_89_orders.md');
  fs.writeFileSync(reportPath, md);
  console.log(`Report generated with ${extraOrders.length} extra orders.`);
}

findExtraOrders()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
