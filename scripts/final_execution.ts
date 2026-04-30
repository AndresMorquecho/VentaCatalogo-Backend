import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function execute() {
  const targetPath = path.join(__dirname, '../scratch/target_receipts.json');
  const receipts: string[] = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));

  console.log(`Starting final migration for ${receipts.length} receipts...`);

  const orders = await prisma.order.findMany({
    where: { receiptNumber: { in: receipts } },
    include: { payments: true }
  });

  console.log(`Processing ${orders.length} orders...`);

  let successCount = 0;
  let paymentCount = 0;
  let errorCount = 0;

  const defaultBank = await prisma.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } });

  for (const order of orders) {
    try {
      const paid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const totalValue = Number(order.realInvoiceTotal || order.total);
      const pending = Math.max(0, totalValue - paid);

      await prisma.$transaction(async (tx) => {
        if (pending > 0.01) {
          const paymentId = randomUUID();
          const method = order.paymentMethod || 'EFECTIVO';
          
          await tx.orderPayment.create({
            data: {
              id: paymentId,
              orderId: order.id,
              amount: pending,
              method: method,
              description: "Regularización masiva - Diego Carrillo",
              createdAt: new Date()
            }
          });

          const bankAccountId = order.bankAccountId || defaultBank?.id;
          if (!bankAccountId) throw new Error("No active CASH bank account found");

          await tx.financialRecord.create({
            data: {
              id: randomUUID(),
              type: 'PAYMENT',
              source: 'ORDER_PAYMENT',
              movementType: 'INCOME',
              amount: pending,
              date: new Date(),
              orderId: order.id,
              orderPaymentId: paymentId,
              clientId: order.clientId,
              clientName: order.clientName,
              createdBy: "diego_david_carrillo_andrade",
              notes: `Abono masivo regularización | Recibo: ${order.receiptNumber}`,
              paymentMethod: method,
              bankAccountId: bankAccountId,
              referenceNumber: `REG-${order.receiptNumber}-${randomUUID().substring(0, 4)}`, // Added unique referenceNumber
              version: 1
            }
          });

          await tx.bankAccount.update({
            where: { id: bankAccountId },
            data: { currentBalance: { increment: pending }, version: { increment: 1 } }
          });

          paymentCount++;
        }

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'ENTREGADO',
            receptionDate: order.receptionDate || new Date(),
            deliveryDate: order.deliveryDate || new Date(),
            deliveredByName: "diego_david_carrillo_andrade",
            notes: order.notes ? `${order.notes}\n[REGULARIZACION 30-04-2026]` : "[REGULARIZACION 30-04-2026]",
            version: { increment: 1 },
            updatedAt: new Date()
          }
        });
      });

      successCount++;
      if (successCount % 50 === 0) console.log(`Progress: ${successCount}/${orders.length} orders processed...`);

    } catch (err) {
      console.error(`Error processing order ${order.receiptNumber}:`, err);
      errorCount++;
    }
  }

  console.log(`Migration complete!`);
  console.log(`- Orders processed: ${successCount}`);
  console.log(`- Payments registered: ${paymentCount}`);
  console.log(`- Errors: ${errorCount}`);
}

execute()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
