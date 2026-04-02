import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class DeleteDeliveryBatchUseCase {
  async execute(batchId: string, userId: string): Promise<Result<any>> {
    console.log(`[DeleteDeliveryBatchUseCase] Executing for batchId: ${batchId} by user: ${userId}`);

    try {
      return await prisma.$transaction(async (tx) => {
        // 1. Get batch with all related orders and payments
        // @ts-ignore
        const batch = await tx.deliveryBatch.findUnique({
          where: { id: batchId },
          include: {
            orders: {
              include: {
                client: {
                  include: { clientAccount: true }
                }
              }
            },
            payments: true,
            financialRecords: true
          }
        });

        if (!batch) {
          return Result.fail('El lote de entrega no existe');
        }

        console.log(`[DeleteDeliveryBatch] Found ${batch.orders.length} orders and ${batch.payments.length} payments in batch`);

        // 2. Revert Financial Records (Bank Accounts and Client Wallet)
        // We iterate through financial records created by this batch
        for (const record of batch.financialRecords) {
          const amount = Number(record.amount);
          
          if (record.movementType === 'INCOME') {
            // It was income (e.g. cash payment), so we subtract from bank account
            await tx.bankAccount.update({
              where: { id: record.bankAccountId },
              data: { currentBalance: { decrement: amount }, version: { increment: 1 } }
            });
          } else if (record.movementType === 'EXPENSE') {
            // It was expense (e.g. cash refund), so we add back to bank account
            await tx.bankAccount.update({
              where: { id: record.bankAccountId },
              data: { currentBalance: { increment: amount }, version: { increment: 1 } }
            });
          } else if (record.movementType === 'INTERNAL' || record.type === 'CREDIT') {
             // Handle wallet (Internal moves between order/wallet)
             // If movement was from WALLET to ORDER (PAYMENT leg), increment wallet
             if (record.fromAccountType === 'WALLET') {
                await tx.clientAccount.update({
                  where: { clientId: record.clientId },
                  data: { totalCreditAvailable: { increment: amount }, version: { increment: 1 } }
                });
             }
             // If movement was from ORDER to WALLET (CREDIT leg), decrement wallet
             if (record.toAccountType === 'WALLET') {
                await tx.clientAccount.update({
                  where: { clientId: record.clientId },
                  data: { totalCreditAvailable: { decrement: amount }, version: { increment: 1 } }
                });
             }
          }
        }

        // 3. Revert Client Credits (Wallet specific records)
        // We delete credits created by this batch and their wallet impact was handled above
        await tx.clientCredit.deleteMany({
          where: { originOrderId: { in: batch.orders.map((o: any) => o.id) }, createdAt: { gte: batch.createdAt } }
        });

        // 4. Delete Payments and Financial Records linked to the batch
        // @ts-ignore
        await tx.financialRecord.deleteMany({ where: { deliveryBatchId: batchId } });
        // @ts-ignore
        await tx.orderPayment.deleteMany({ where: { deliveryBatchId: batchId } });

        // 5. Update Orders back to RECIBIDO_EN_BODEGA
        await tx.order.updateMany({
          where: { deliveryBatchId: batchId },
          data: {
            status: 'RECIBIDO_EN_BODEGA',
            deliveryDate: null,
            deliveredByName: null,
            deliveryBatchId: null,
            deliveryNumber: null,
            updatedAt: new Date(),
            version: { increment: 1 }
          }
        });

        // 6. Delete Inventory movements
        await tx.inventoryMovement.deleteMany({
          where: { orderId: { in: batch.orders.map((o: any) => o.id) }, type: 'DELIVERED' }
        });

        // 6.5. Reverse Exchange Batch statuses if any orders were linked
        for (const order of batch.orders) {
          if (order.parentOrderId) {
            const batchItem = await tx.exchangeBatchItem.findFirst({
              where: { orderId: order.parentOrderId },
              include: { batch: true }
            });

            if (batchItem && batchItem.batch.status === 'ENTREGADO') {
              // Revert to EN_BODEGA
              await tx.exchangeBatch.update({
                where: { id: batchItem.batchId },
                data: { 
                    status: 'EN_BODEGA',
                    deliveredAt: null,
                    updatedAt: new Date()
                }
              });
              console.log(`[Revert-Batch-Delivery] Exchange Batch ${batchItem.batchId} reverted to EN_BODEGA because delivery was deleted`);
            }
          }
        }

        // 7. Delete the Batch record itself
        // @ts-ignore
        await tx.deliveryBatch.delete({ where: { id: batchId } });

        console.log(`[DeleteDeliveryBatch] Reversal completed successfully`);
        return Result.ok({ success: true, message: 'Lote de entrega eliminado y saldos reversados correctamente' });
      });
    } catch (error) {
      console.error('[DeleteDeliveryBatchUseCase] Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al eliminar el lote de entrega');
    }
  }
}
