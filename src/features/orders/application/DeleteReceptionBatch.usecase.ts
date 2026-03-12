import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class DeleteReceptionBatchUseCase {
  async execute(batchId: string): Promise<Result<void>> {
    try {
      return await prisma.$transaction<Result<void>>(async (tx: any) => {
        // 1. Encontrar el lote con sus pedidos
        const batch = await tx.receptionBatch.findUnique({
          where: { id: batchId },
          include: {
            orders: {
              include: {
                payments: true
              }
            }
          }
        });

        if (!batch) {
          throw new Error('Lote de recepción no encontrado');
        }

        // 2. Validaciones de negocio: Con que UNO solo no cumpla, NO se puede revertir el lote
        for (const order of batch.orders) {
          if (order.status === 'ENTREGADO') {
            throw new Error(`El pedido ${order.receiptNumber} del cliente ${order.clientName} ya ha sido entregado. No se puede revertir el lote.`);
          }
        }

        // 3. Revertir cada pedido (Reutilizando la lógica de reversión individual)
        // Pero lo haremos manual aquí para asegurar que sea atómico para el batch
        for (const order of batch.orders) {
          // Identificar abonos de recepción de este pedido
          const receptionPayments = order.payments.filter((p: any) => 
            p.description === 'Abono en recepción de bodega (Packing)'
          );

          for (const payment of receptionPayments) {
            // Revertir bancos/caja si aplica
            const financialRecords = await tx.financialRecord.findMany({
              where: { orderPaymentId: payment.id }
            });

            for (const fr of financialRecords) {
              await tx.bankAccount.update({
                where: { id: fr.bankAccountId },
                data: { 
                    currentBalance: { decrement: fr.amount },
                    version: { increment: 1 }
                }
              });
              await tx.financialRecord.delete({ where: { id: fr.id } });
            }
            await tx.orderPayment.delete({ where: { id: payment.id } });
          }

          // Eliminar movimientos de inventario de entrada
          await tx.inventoryMovement.deleteMany({
            where: { orderId: order.id, type: 'ENTRY' }
          });

          // Revertir créditos generados
          const credits = await tx.clientCredit.findMany({
            where: { originOrderId: order.id, status: 'AVAILABLE' }
          });

          for (const credit of credits) {
            const account = await tx.clientAccount.findFirst({
                where: { id: credit.clientAccountId }
            });
            if (account) {
                await tx.clientAccount.update({
                    where: { id: account.id },
                    data: { 
                        totalCreditAvailable: { decrement: credit.remainingAmount },
                        version: { increment: 1 }
                    }
                });
            }
            await tx.clientCredit.delete({ where: { id: credit.id } });
          }

          // Regresar pedido a POR_RECIBIR
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'POR_RECIBIR',
              receptionDate: null,
              receivedByName: null,
              realInvoiceTotal: null,
              invoiceNumber: null,
              documentType: 'FACTURA',
              receptionBatchId: null, // Desvincular del batch
              version: { increment: 1 }
            }
          });
        }

        // 4. Eliminar el lote de recepción
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
