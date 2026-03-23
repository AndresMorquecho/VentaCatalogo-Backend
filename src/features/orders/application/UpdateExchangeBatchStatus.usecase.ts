import { StatusTransitionService, ExchangeBatchStatus } from './StatusTransitionService';

/**
 * UpdateExchangeBatchStatusUseCase
 * 
 * Use case for updating the status of an ExchangeBatch.
 * Delegates validation to StatusTransitionService to ensure transitions
 * follow the valid sequence: ENVIADO → EN_BODEGA → ENTREGADO
 * 
 * Requirements: 2.2, 2.3, 2.4, 2.5, 2.6
 */
export class UpdateExchangeBatchStatusUseCase {
  private statusTransitionService: StatusTransitionService;

  constructor(statusTransitionService: StatusTransitionService) {
    this.statusTransitionService = statusTransitionService;
  }

  /**
   * Executes the status update for an ExchangeBatch
   * @param batchId - The ID of the batch to update
   * @param newStatus - The new status to transition to
   * @returns The updated ExchangeBatch with new status and timestamps
   * @throws StateTransitionError if the transition is invalid
   */
  async execute(batchId: string, newStatus: ExchangeBatchStatus) {
    return await this.statusTransitionService.transitionBatchStatus(
      batchId,
      newStatus
    );
  }
}
