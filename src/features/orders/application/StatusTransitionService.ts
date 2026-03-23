import { prisma } from '../../../lib/prisma';

/**
 * ExchangeBatchStatus type
 * 
 * Valid status values for ExchangeBatch entities
 */
export type ExchangeBatchStatus = 'ENVIADO' | 'EN_BODEGA' | 'ENTREGADO';

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
    ENVIADO: ['EN_BODEGA'],
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
    newStatus: ExchangeBatchStatus
  ): Promise<any> {
    // Load the current batch
    const batch = await prisma.exchangeBatch.findUnique({
      where: { id: batchId }
    });

    if (!batch) {
      throw new Error(`ExchangeBatch with id ${batchId} not found`);
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

    // Set timestamp based on new status
    if (newStatus === 'EN_BODEGA') {
      updateData.receivedAt = new Date();
    } else if (newStatus === 'ENTREGADO') {
      updateData.deliveredAt = new Date();
    }

    // Update the batch
    const updatedBatch = await prisma.exchangeBatch.update({
      where: { id: batchId },
      data: updateData
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
