import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function findDuplicates() {
  const targetPath = path.join(__dirname, '../scratch/target_receipts.json');
  const receipts: string[] = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));

  const orders = await prisma.order.findMany({
    where: { receiptNumber: { in: receipts } },
    select: {
      receiptNumber: true,
      orderNumber: true,
      clientName: true,
      brandId: true,
      total: true
    }
  });

  const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
  const brandMap = Object.fromEntries(brands.map(b => [b.id, b.name]));

  // Group by receiptNumber
  const groups: Record<string, any[]> = {};
  for (const o of orders) {
    if (!groups[o.receiptNumber]) groups[o.receiptNumber] = [];
    groups[o.receiptNumber].push(o);
  }

  // Filter groups with more than 1 order
  const multiOrderReceipts = Object.entries(groups).filter(([r, orders]) => orders.length > 1);

  let md = "# Recibos con Múltiples Órdenes Asociadas\n\n";
  md += `Se identificaron ${multiOrderReceipts.length} recibos que contienen más de un pedido interno. Esto explica por qué el total de órdenes procesadas (1,597) es mayor al total de recibos únicos (1,508).\n\n`;

  md += "| Recibo | Pedido | Cliente | Marca | Total |\n";
  md += "| --- | --- | --- | --- | --- |\n";

  for (const [receipt, orders] of multiOrderReceipts) {
    for (const o of orders) {
      md += `| ${receipt} | ${o.orderNumber || '-'} | ${o.clientName} | ${brandMap[o.brandId] || 'Desconocida'} | $${Number(o.total).toFixed(2)} |\n`;
    }
    md += "| --- | --- | --- | --- | --- |\n"; // Separator between groups
  }

  const reportPath = path.join(__dirname, '../scratch/multi_order_report.md');
  fs.writeFileSync(reportPath, md);
  console.log(`Report generated with ${multiOrderReceipts.length} multi-order receipts.`);
}

findDuplicates()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
