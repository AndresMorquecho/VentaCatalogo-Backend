import { prisma } from '../../../lib/prisma';

/**
 * ExchangeBatchStatus type
 * 
 * Valid status values for ExchangeBatch entities
 */
export type ExchangeBatchStatus = 'POR_ENVIAR' | 'EN_TRANSITO' | 'EN_BODEGA' | 'ENTREGADO';

/**
 * StateTransitionError
 * 
 * Error thrown when an invalid status transition is attempted.
 * Contains information about the current status and the attempted status.
 */
export class StateTransitionError extends Error {
  public readonly statusCode = 409;
  public readonly currentStatus: string;
  public readonly attemptedStatus: string;

  constructor(currentStatus: string, attemptedStatus: string) {
    super(
      `Transición de estado inválida: ${currentStatus} → ${attemptedStatus}`
    );
    this.name = 'StateTransitionError';
    this.currentStatus = currentStatus;
    this.attemptedStatus = attemptedStatus;
    Object.setPrototypeOf(this, StateTransitionError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      currentStatus: this.currentStatus,
      attemptedStatus: this.attemptedStatus,
      statusCode: this.statusCode
    };
  }
}

/**
 * StatusTransitionService
 * 
 * Service responsible for managing status transitions of ExchangeBatch entities.
 * Validates transitions follow the sequence: ENVIADO → EN_BODEGA → ENTREGADO
 * Updates corresponding timestamps (receivedAt, deliveredAt) on transitions.
 * 
 * Requirements: 2.2, 2.3, 2.4, 2.5, 2.6
 */
export class StatusTransitionService {
  /**
   * Valid status transitions map
   * Defines which status transitions are allowed from each state
   */
  private readonly validTransitions: Record<ExchangeBatchStatus, ExchangeBatchStatus[]> = {
    POR_ENVIAR: ['EN_TRANSITO', 'EN_BODEGA'],
    EN_TRANSITO: ['EN_BODEGA'],
    EN_BODEGA: ['ENTREGADO'],
    ENTREGADO: []
  };

  /**
   * Validates and executes status transition for an ExchangeBatch
   * @param batchId - The ID of the batch to transition
   * @param newStatus - The new status to transition to
   * @returns The updated ExchangeBatch
   * @throws StateTransitionError if transition is invalid
   */
  async transitionBatchStatus(
    batchId: string,
    newStatus: ExchangeBatchStatus,
    trackingGuide?: string
  ): Promise<any> {
    // Load the current batch
    let batch = await prisma.exchangeBatch.findUnique({
      where: { id: batchId }
    });

    // Fallback: Search by batchNumber
    if (!batch) {
      batch = await prisma.exchangeBatch.findUnique({
        where: { batchNumber: batchId }
      });
    }

    // Fallback: Search by receiptNumber in items
    if (!batch) {
      const itemWithBatch = await prisma.exchangeBatchItem.findFirst({
        where: { receiptNumber: batchId },
        include: { batch: true }
      });
      if (itemWithBatch) {
        batch = itemWithBatch.batch;
        batchId = batch.id;
      }
    }

    if (!batch) {
        console.log(`[StatusTransition] No explicit batch found for ${batchId}, will check for orders in the main transaction...`);
    }

    // Validate the transition only if we found a formal batch entity
    if (batch && !this.isValidTransition(batch.status as ExchangeBatchStatus, newStatus)) {
      throw new StateTransitionError(batch.status, newStatus);
    }

    // Prepare update data
    const updateData: any = {
      status: newStatus,
      updatedAt: new Date()
    };

    if (trackingGuide) {
      updateData.trackingGuide = trackingGuide;
    }

    // Set timestamp based on new status
    if (newStatus === 'EN_TRANSITO') {
      updateData.sentAt = new Date();
    } else if (newStatus === 'EN_BODEGA') {
      updateData.receivedAt = new Date();
    } else if (newStatus === 'ENTREGADO') {
      updateData.deliveredAt = new Date();
    }

    // Update the batch and its associated orders in a transaction
    return await prisma.$transaction(async (tx) => {
      // --- 🔒 CONCURRENCY & UNIQUE GUIDE CHECK ---
      if (trackingGuide) {
        // Check if guide already exists in non-technical OrderReceipts
        const existingReceipt = await (tx as any).orderReceipt.findUnique({
          where: { receiptNumber: trackingGuide }
        });

        // If it exists, we must only allow it if it's ALREADY associated with this batch 
        // (e.g. part of a partial update or the same batch being updated again)
        // But since we are renaming technical IDs to this guide, if it exists, it means 
        // another REAL guide or batch already has it.
        if (existingReceipt && !existingReceipt.receiptNumber.startsWith('SN-') && !existingReceipt.receiptNumber.startsWith('S/N-')) {
           // Check if any order with this receipt number belongs to a DIFFERENT batch
           const otherOrder = await tx.order.findFirst({
             where: { 
               receiptNumber: trackingGuide,
               NOT: { exchangeBatchItems: { some: { batchId: batchId } } }
             }
           });
           if (otherOrder) {
             throw new Error(`La guía "${trackingGuide}" ya existe y está asociada a otros pedidos (ej: ${otherOrder.orderNumber}). Por favor usa un número diferente.`);
           }
        }
      }

      let batch: any = null;
      let orderIds: string[] = [];
      let receiptsToProcess: string[] = [];

      // 1. Try to find the batch by UUID first
      try {
        batch = await tx.exchangeBatch.findUnique({
          where: { id: batchId },
          include: { items: true }
        });
      } catch (e) {
        // Not a UUID or other error
      }

      if (batch) {
        // formal batch update
        await tx.exchangeBatch.update({
          where: { id: batchId },
          data: updateData
        });
        orderIds = batch.items.map((i: any) => i.orderId);
        receiptsToProcess = [...new Set(batch.items.map((i: any) => i.receiptNumber).filter(Boolean) as string[])];
      } else {
        // Fallback: If batchId is not a batch UUID, treat it as a receiptNumber/identifier
        // This handles groups of orders that aren't yet in a formal "Lote" entity
        const ordersByReceipt = await tx.order.findMany({
          where: { 
            OR: [
              { receiptNumber: batchId },
              { id: batchId } // possibly a single order ID
            ]
          },
          select: { id: true, receiptNumber: true }
        });

        if (ordersByReceipt.length > 0) {
          orderIds = ordersByReceipt.map(o => o.id);
          receiptsToProcess = [...new Set(ordersByReceipt.map(o => o.receiptNumber).filter(Boolean) as string[])];
        } else {
          throw new Error(`No se encontró lote o pedidos con el identificador: ${batchId}`);
        }
      }

      // Map batch status to Order status
      let orderStatus: any = null;
      if (newStatus === 'EN_TRANSITO') orderStatus = 'EN_TRANSITO';
      else if (newStatus === 'EN_BODEGA') orderStatus = 'RECIBIDO_EN_BODEGA';
      else if (newStatus === 'ENTREGADO') orderStatus = 'ENTREGADO';

      // If we have a tracking guide, propagation of this number to all related fields is critical
      if (trackingGuide) {
        console.log(`[DEBUG] Starting rename for tracked guide: ${trackingGuide}`);
        
        // 1. Update ALL orders in this batch to use the Guide as Receipt Number
        const updatedOrders = await tx.order.updateMany({
          where: { id: { in: orderIds } },
          data: { 
            receiptNumber: trackingGuide,
            trackingGuide: trackingGuide,
            version: { increment: 1 } 
          }
        });
        console.log(`[DEBUG] Updated ${updatedOrders.count} orders with guide ${trackingGuide}`);

        // 2. Identify all UNIQUE old technical receipts to rename them in OrderReceipt table
        const technicalReceipts = receiptsToProcess.filter(r => r.startsWith('S/N-') || r.startsWith('SN-'));
        
        console.log(`[DEBUG] Found ${technicalReceipts.length} technical IDs to rename in OrderReceipt:`, technicalReceipts);

        for (const oldReceipt of technicalReceipts) {
          const newReceipt = trackingGuide;
          
          try {
            const exists = await tx.orderReceipt.findUnique({ where: { receiptNumber: newReceipt } });
            if (!exists) {
              await (tx as any).orderReceipt.update({
                where: { receiptNumber: oldReceipt },
                data: { receiptNumber: newReceipt, version: { increment: 1 } }
              });
              console.log(`[DEBUG] Successfully renamed OrderReceipt ${oldReceipt} to ${newReceipt}`);
            } else {
              console.log(`[DEBUG] Target ${newReceipt} already exists, updating associated orders for ${oldReceipt}`);
              const resOther = await tx.order.updateMany({
                where: { receiptNumber: oldReceipt },
                data: { receiptNumber: newReceipt, version: { increment: 1 } }
              });
              console.log(`[DEBUG] Updated ${resOther.count} other orders sharing the same old receipt ${oldReceipt}`);
            }
          } catch (e: any) {
            console.log(`[DEBUG] Error renaming OrderReceipt ${oldReceipt}: ${e.message}`);
          }

          // 3. Ensure ANY other ExchangeBatchItem sharing this technical ID is also updated
          const resItems = await (tx as any).exchangeBatchItem.updateMany({
            where: { receiptNumber: oldReceipt },
            data: { receiptNumber: newReceipt }
          });
          console.log(`[DEBUG] Updated ${resItems.count} exchange items from receipt ${oldReceipt}`);
        }
      }

      if (orderStatus) {
        await tx.order.updateMany({
          where: { id: { in: orderIds } },
          data: { 
            status: orderStatus,
            updatedAt: new Date()
          }
        });
        console.log(`[DEBUG] Moved ${orderIds.length} orders to ${orderStatus}`);
      }

      return batch || { id: batchId, status: newStatus, trackingGuide };
    });
  }

  /**
   * Checks if a status transition is valid
   * @param currentStatus - The current status of the batch
   * @param newStatus - The desired new status
   * @returns true if the transition is valid, false otherwise
   */
  private isValidTransition(
    currentStatus: ExchangeBatchStatus,
    newStatus: ExchangeBatchStatus
  ): boolean {
    const allowedTransitions = this.validTransitions[currentStatus];
    return allowedTransitions?.includes(newStatus) ?? false;
  }
}
