import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class DeleteReceptionBatchUseCase {
  async execute(batchId: string): Promise<Result<void>> {
    try {
      return await prisma.$transaction<Result<void>>(async (tx: any) => {
        // 1. Get existing batch with all its orders
        const batch = await tx.receptionBatch.findUnique({
          where: { id: batchId },
          select: {
            id: true,
            packingNumber: true,
            orders: {
              select: { id: true, receiptNumber: true, status: true, clientId: true, clientName: true }
            }
          }
        });

        if (!batch) throw new Error('Lote de recepción no encontrado');

        const orderIds = batch.orders.map((o: any) => o.id);

        // 2. Validation: No delivered orders
        for (const order of batch.orders) {
          if (order.status === 'ENTREGADO') {
            throw new Error(`El pedido ${order.receiptNumber} ya ha sido entregado. No se puede revertir el lote.`);
          }
        }

        console.log(`🔄 Reverting all effects for batch ${batch.packingNumber} (${orderIds.length} orders)`);

        // 3. Find all payments created by this reception (Abonos + Distributive Credits)
        const paymentsToRevert = await tx.orderPayment.findMany({
          where: {
            OR: [
              // Basic cash payments during reception
              { orderId: { in: orderIds }, description: 'Abono en recepción de bodega (Packing)' },
              // Distributive payments from orders in this batch (Target is ANY order)
              { reference: { in: orderIds.map((id: string) => `SALDO-DIST-${id}`) } },
              // Distributive payments TO orders in this batch (Source can be ANY order)
              { orderId: { in: orderIds }, method: 'CREDITO_CLIENTE', reference: { startsWith: 'SALDO-DIST-' } }
            ]
          },
          select: { id: true, amount: true, orderId: true, method: true }
        });

        const paymentIds = paymentsToRevert.map((p: any) => p.id);

        // 4. Find all financial records associated with these payments or orders
        const recordsToRevert = await tx.financialRecord.findMany({
          where: {
            OR: [
              { orderPaymentId: { in: paymentIds } },
              { orderId: { in: orderIds }, type: { in: ['CREDIT_GENERATION', 'CREDIT_APPLICATION'] } },
              { notes: { contains: batch.packingNumber } } // Safety net
            ]
          },
          select: { id: true, bankAccountId: true, amount: true, movementType: true }
        });

        // 5. Revert Bank Accounts
        const bankReversions = new Map<string, number>();
        for (const rec of recordsToRevert) {
          if (rec.bankAccountId === 'virtual-credit-account' || rec.bankAccountId === 'cash-return') continue;
          
          const current = bankReversions.get(rec.bankAccountId) || 0;
          // Reverse: INCOME -> decrement, EXPENSE -> increment
          const change = rec.movementType === 'INCOME' ? -Number(rec.amount) : Number(rec.amount);
          bankReversions.set(rec.bankAccountId, current + change);
        }

        for (const [bankAccountId, amount] of bankReversions) {
          if (amount === 0) continue;
          await tx.bankAccount.update({
            where: { id: bankAccountId },
            data: { currentBalance: { increment: amount }, version: { increment: 1 } }
          });
        }

        // 6. Revert Client Credits (Wallet)
        const creditsToRevert = await tx.clientCredit.findMany({
          where: { originOrderId: { in: orderIds }, status: 'AVAILABLE' },
          select: { id: true, clientAccountId: true, remainingAmount: true }
        });

        if (creditsToRevert.length > 0) {
          const creditReversions = new Map<string, number>();
          for (const credit of creditsToRevert) {
            const current = creditReversions.get(credit.clientAccountId) || 0;
            creditReversions.set(credit.clientAccountId, current + Number(credit.remainingAmount));
          }

          for (const [accountId, amount] of creditReversions) {
            await tx.clientAccount.update({
              where: { id: accountId },
              data: { totalCreditAvailable: { decrement: amount }, version: { increment: 1 } }
            });
          }

          await tx.clientCredit.deleteMany({ where: { id: { in: creditsToRevert.map((c: any) => c.id) } } });
        }

        // 7. Delete records and payments
        if (recordsToRevert.length > 0) {
          await tx.financialRecord.deleteMany({ where: { id: { in: recordsToRevert.map((r: any) => r.id) } } });
        }
        if (paymentIds.length > 0) {
          await tx.orderPayment.deleteMany({ where: { id: { in: paymentIds } } });
        }

        // 8. Delete inventory movements
        await tx.inventoryMovement.deleteMany({
          where: { orderId: { in: orderIds }, type: 'ENTRY' }
        });

        // 9. Revert orders status
        await tx.order.updateMany({
          where: { id: { in: orderIds } },
          data: {
            status: 'POR_RECIBIR',
            receptionDate: null,
            receivedByName: null,
            realInvoiceTotal: null,
            invoiceNumber: null,
            documentType: 'FACTURA',
            receptionBatchId: null,
            packingNumber: null,
            packingTotal: null,
            orderNumber: null,
            version: { increment: 1 }
          }
        });

        // 10. Delete the batch
        await tx.receptionBatch.delete({
          where: { id: batchId }
        });

        return Result.ok();
      });
    } catch (error) {
      console.error('DeleteReceptionBatchUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al revertir el lote de recepción');
    }
  }
}
