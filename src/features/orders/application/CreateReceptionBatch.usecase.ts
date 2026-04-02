import { prisma } from '../../../lib/prisma';
import { ReceiveOrderUseCase, ReceiveOrderDTO } from './ReceiveOrder.usecase';
import { Result } from '../../../shared/domain/Result';
import { getNextSequence } from '../../../shared/utils/SequenceGenerator';

export interface BatchReceptionDTO {
  id?: string; // Optional for updates
  packingNumber: string;
  packingTotal: number;
  items: Array<ReceiveOrderDTO & { orderId: string }>;
}

export class CreateReceptionBatchUseCase {
  constructor(private receiveOrderUseCase: ReceiveOrderUseCase) {}

  async execute(dto: BatchReceptionDTO, userId: string): Promise<Result<any>> {
    try {
      if (!dto.items || dto.items.length === 0) {
        return Result.fail('No hay pedidos para procesar');
      }

      const results = await prisma.$transaction(async (tx) => {
        let batch;
        
        if (dto.id) {
          // --- MODO EDICIÓN ---
          const originalBatch = await tx.receptionBatch.findUnique({
            where: { id: dto.id },
            include: { orders: true }
          });

          if (!originalBatch) throw new Error('El lote a editar no existe');

          // Ensure name change is reflected in the update
          batch = await tx.receptionBatch.update({
            where: { id: dto.id },
            data: {
              packingNumber: dto.packingNumber,
              packingTotal: dto.packingTotal,
              updatedAt: new Date()
            }
          });
          
          // Identify orders to remove completely from batch (not in new items)
          const newItemOrderIds = dto.items.map(i => i.orderId);
          const ordersToRemove = originalBatch.orders.filter((o: any) => !newItemOrderIds.includes(o.id));

          for (const order of ordersToRemove) {
            // Revertir este pedido (usando la lógica de reversión pero adaptada aquí)
            // IMPORTANTE: Solo si no ha sido entregado
            if (order.status === 'ENTREGADO') {
              throw new Error(`No se puede quitar el pedido ${order.receiptNumber} porque ya ha sido entregado.`);
            }

            // Eliminar abonos de recepción
            const receptionPayments = await tx.orderPayment.findMany({
              where: { 
                orderId: order.id, 
                description: 'Abono en recepción de bodega (Packing)' 
              }
            });

            for (const payment of receptionPayments) {
              const frs = await tx.financialRecord.findMany({ where: { orderPaymentId: payment.id } });
              for (const fr of frs) {
                await tx.bankAccount.update({
                  where: { id: fr.bankAccountId },
                  data: { currentBalance: { decrement: fr.amount }, version: { increment: 1 } }
                });
                await tx.financialRecord.delete({ where: { id: fr.id } });
              }
              await tx.orderPayment.delete({ where: { id: payment.id } });
            }

            await tx.inventoryMovement.deleteMany({ where: { orderId: order.id, type: 'ENTRY' } });
            
            // Revertir créditos
            const credits = await tx.clientCredit.findMany({ where: { originOrderId: order.id, status: 'AVAILABLE' } });
            for (const credit of credits) {
              await tx.clientAccount.updateMany({ 
                where: { id: credit.clientAccountId }, 
                data: { totalCreditAvailable: { decrement: credit.remainingAmount }, version: { increment: 1 } } 
              });
              await tx.clientCredit.delete({ where: { id: credit.id } });
            }

            // Regresar a pendiente y desvincular
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: 'POR_RECIBIR',
                receptionDate: null,
                receivedByName: null,
                realInvoiceTotal: null,
                invoiceNumber: null,
                receptionBatchId: null,
                version: { increment: 1 }
              }
            });
          }
        } else {
          // --- MODO CREACIÓN (con control de concurrencia) ---
          const finalPackingNumber = await getNextSequence('PK-', 'PACKING');
          console.log(`✅ Robust packing number generated: ${finalPackingNumber}`);
          dto.packingNumber = finalPackingNumber;

          batch = await tx.receptionBatch.create({
            data: {
              packingNumber: finalPackingNumber,
              packingTotal: dto.packingTotal,
              receivedByName: userId,
              receptionDate: new Date(),
            }
          });
        }

        const orderResults = [];
        
        // 3. Procesar / Actualizar cada pedido en el DTO
        for (const item of dto.items) {
          // Si estamos editando y el pedido ya estaba en el lote, necesitamos primero "limpiar" 
          // ciertos campos para que la lógica de ReceiveOrderUseCase no falle al pensar que ya fue recibido
          // pero en realidad estamos actualizandolo. 
          // Estrategia: Ponemos el pedido en POR_RECIBIR temporalmente si ya era del lote
          const existingOrder = await tx.order.findUnique({ where: { id: item.orderId } });
          if (existingOrder && existingOrder.receptionBatchId === batch.id) {
            // Limpiamos abonos previos de recepción para evitar duplicados al re-procesar
            const prevPayments = await tx.orderPayment.findMany({
              where: { orderId: item.orderId, description: 'Abono en recepción de bodega (Packing)' }
            });
            for (const p of prevPayments) {
              const frs = await tx.financialRecord.findMany({ where: { orderPaymentId: p.id } });
              for (const fr of frs) {
                await tx.bankAccount.update({
                  where: { id: fr.bankAccountId },
                  data: { currentBalance: { decrement: fr.amount }, version: { increment: 1 } }
                });
                await tx.financialRecord.delete({ where: { id: fr.id } });
              }
              await tx.orderPayment.delete({ where: { id: p.id } });
            }
            await tx.inventoryMovement.deleteMany({ where: { orderId: item.orderId, type: 'ENTRY' } });
            
            // Revertir créditos previos
            const prevCredits = await tx.clientCredit.findMany({ where: { originOrderId: item.orderId, status: 'AVAILABLE' } });
            for (const c of prevCredits) {
              await tx.clientAccount.updateMany({ 
                where: { id: c.clientAccountId }, 
                data: { totalCreditAvailable: { decrement: c.remainingAmount }, version: { increment: 1 } } 
              });
              await tx.clientCredit.delete({ where: { id: c.id } });
            }

            // Reset temporal para re-recepcionar con nuevos valores
            await tx.order.update({
              where: { id: item.orderId },
              data: { status: 'POR_RECIBIR', receptionBatchId: null }
            });
          }

          const res = await this.receiveOrderUseCase.execute(
            item.orderId,
            {
              ...item,
              receptionBatchId: batch.id,
              packingNumber: dto.packingNumber,
              packingTotal: dto.packingTotal
            } as any,
            userId,
            tx
          );
          orderResults.push(res);
        }

        return {
          batch,
          orders: orderResults
        };
      }, {
        maxWait: 30000,
        timeout: 90000
      });

      return Result.ok(results);
    } catch (error) {
      console.error('CreateReceptionBatchUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al procesar recepción por lote');
    }
  }
}
