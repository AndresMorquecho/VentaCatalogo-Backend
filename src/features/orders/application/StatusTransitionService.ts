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
      // If still no batch, check if there are orders with this receiptNumber to update them directly
      console.log(`[StatusTransition] No explicit batch found for ${batchId}, checking for orders with this receiptNumber...`);
      const orders = await prisma.order.findMany({
        where: { receiptNumber: batchId, type: 'CAMBIO' }
      });
      console.log(`[StatusTransition] Found ${orders.length} orders for receipt ${batchId}`);

      if (orders.length > 0) {
          // Manual update for unbatched orders
          let orderStatus: any = null;
          if (newStatus === 'EN_TRANSITO') orderStatus = 'EN_TRANSITO';
          else if (newStatus === 'EN_BODEGA') orderStatus = 'RECIBIDO_EN_BODEGA';
          else if (newStatus === 'ENTREGADO') orderStatus = 'ENTREGADO';

          if (orderStatus) {
              await prisma.order.updateMany({
                  where: { receiptNumber: batchId, type: 'CAMBIO' },
                  data: { 
                      status: orderStatus,
                      trackingGuide: trackingGuide || undefined,
                      updatedAt: new Date()
                  }
              });
              return { success: true, message: 'Orders updated by receipt number' };
          }
      }
      
      throw new Error(`ExchangeBatch o Guía with identifier ${batchId} not found`);
    }

    // Validate the transition
    if (!this.isValidTransition(batch.status as ExchangeBatchStatus, newStatus)) {
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
    const updatedBatch = await prisma.$transaction(async (tx) => {
      const batch = await tx.exchangeBatch.update({
        where: { id: batchId },
        data: updateData,
        include: { items: true }
      });

      // Map batch status to Order status
      let orderStatus: any = null;
      if (newStatus === 'EN_TRANSITO') orderStatus = 'EN_TRANSITO';
      else if (newStatus === 'EN_BODEGA') orderStatus = 'RECIBIDO_EN_BODEGA';
      else if (newStatus === 'ENTREGADO') orderStatus = 'ENTREGADO';

      // If we have a tracking guide, we might want to standardize the receipt numbers
      // of all items in this batch to match the guide if they were technical IDs
      // If we have a Tracking Guide, propagation of this number to all related fields is critical
      // for the UI to stop showing "-" or "SIN GUÍA".
      if (trackingGuide) {
        const orderIds = batch.items.map(item => item.orderId);
        
        // 1. Update ALL orders in this batch to use the Guide as Receipt Number
        await tx.order.updateMany({
          where: { id: { in: orderIds } },
          data: { 
            receiptNumber: trackingGuide,
            trackingGuide: trackingGuide,
            version: { increment: 1 } 
          }
        });

        // 2. Identify all UNIQUE old technical receipts to rename them in OrderReceipt table
        const technicalReceipts = [...new Set(batch.items
          .map(item => item.receiptNumber)
          .filter(r => r.startsWith('S/N-') || r.startsWith('SN-')))];

        for (const oldReceipt of technicalReceipts) {
          const newReceipt = trackingGuide;
          
          // Rename OrderReceipt record to maintain referential integrity with other orders sharing it
          try {
            const exists = await tx.orderReceipt.findUnique({ where: { receiptNumber: newReceipt } });
            if (!exists) {
              await (tx as any).orderReceipt.update({
                where: { receiptNumber: oldReceipt },
                data: { receiptNumber: newReceipt, version: { increment: 1 } }
              });
            } else {
              // If it already exists, just update remaining orders that weren't in this batch but share the old ID
              await tx.order.updateMany({
                where: { receiptNumber: oldReceipt },
                data: { receiptNumber: newReceipt, version: { increment: 1 } }
              });
            }
          } catch (e: any) {
            console.log(`[StatusTransition] Optional rename of OrderReceipt ${oldReceipt} skipped: ${e.message}`);
          }

          // 3. Ensure ANY other ExchangeBatchItem sharing this technical ID is also updated
          await (tx as any).exchangeBatchItem.updateMany({
            where: { receiptNumber: oldReceipt },
            data: { receiptNumber: newReceipt }
          });
        }
        
        // 4. Update THIS batch's item references in-memory for the returned object
        batch.items.forEach(item => {
          if (item.receiptNumber.startsWith('S/N-') || item.receiptNumber.startsWith('SN-')) {
            item.receiptNumber = trackingGuide;
          }
        });
      }

      if (orderStatus) {
        const orderIds = batch.items.map(item => item.orderId);
        await tx.order.updateMany({
          where: { id: { in: orderIds } },
          data: { 
            status: orderStatus,
            updatedAt: new Date()
          }
        });
      }

      return batch;
    });

    return updatedBatch;
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
