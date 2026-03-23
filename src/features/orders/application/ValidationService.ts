import { prisma } from '../../../lib/prisma';

/**
 * ValidationError
 * 
 * Error thrown when order validation fails during exchange batch creation.
 * Contains detailed information about which orders failed validation and why.
 */
export class ValidationError extends Error {
  public readonly code: string;
  public readonly statusCode = 400;
  public readonly details?: {
    orderId: string;
    receiptNumber: string;
    currentStatus?: string;
    activeBatchNumbers?: string[];
  }[];

  constructor(
    code: string,
    message: string,
    details?: {
      orderId: string;
      receiptNumber: string;
      currentStatus?: string;
      activeBatchNumbers?: string[];
    }[]
  ) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      statusCode: this.statusCode
    };
  }
}

/**
 * ValidationService
 * 
 * Service responsible for validating business rules before creating exchange batches.
 * Validates:
 * - Orders are in ENTREGADO status
 * - Orders don't have ExchangeBatchItems in active batches (ENVIADO or EN_BODEGA)
 * - Orders are not shadow orders (parentOrderId is null)
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 7.1, 7.2, 7.3
 */
export class ValidationService {
  /**
   * Validates that orders are eligible for exchange batch creation
   * @throws ValidationError if validation fails with descriptive message
   */
  async validateOrdersForBatch(orderIds: string[]): Promise<void> {
    // Load orders with their exchange batch items
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        exchangeBatchItems: {
          include: {
            batch: true
          }
        }
      }
    });

    // Check all orders exist
    if (orders.length !== orderIds.length) {
      throw new ValidationError(
        'ORDERS_NOT_FOUND',
        'Uno o más pedidos no fueron encontrados'
      );
    }

    // Validate each order
    const invalidOrders: {
      orderId: string;
      receiptNumber: string;
      currentStatus?: string;
      activeBatchNumbers?: string[];
    }[] = [];

    for (const order of orders) {
      // Check if order is a shadow order (parentOrderId is not null)
      if (order.parentOrderId !== null) {
        invalidOrders.push({
          orderId: order.id,
          receiptNumber: order.receiptNumber,
          currentStatus: order.status
        });
        continue;
      }

      // Check if order is in ENTREGADO status
      if (order.status !== 'ENTREGADO') {
        invalidOrders.push({
          orderId: order.id,
          receiptNumber: order.receiptNumber,
          currentStatus: order.status
        });
        continue;
      }

      // Check if order is already in an active batch
      const activeBatchNumbers = await this.getActiveBatchNumbers(order.id);
      if (activeBatchNumbers.length > 0) {
        invalidOrders.push({
          orderId: order.id,
          receiptNumber: order.receiptNumber,
          activeBatchNumbers
        });
      }
    }

    // If there are invalid orders, throw validation error
    if (invalidOrders.length > 0) {
      // Build descriptive error message
      const messages: string[] = [];
      
      for (const invalid of invalidOrders) {
        if (invalid.activeBatchNumbers && invalid.activeBatchNumbers.length > 0) {
          messages.push(
            `El pedido ${invalid.receiptNumber} ya está incluido en los siguientes lotes activos: ${invalid.activeBatchNumbers.join(', ')}. Un pedido no puede estar en múltiples guías simultáneamente.`
          );
        } else if (invalid.currentStatus !== 'ENTREGADO') {
          messages.push(
            `El pedido ${invalid.receiptNumber} no puede ser incluido porque su estado actual es ${invalid.currentStatus}. Solo pedidos con estado ENTREGADO pueden ser enviados a cambio.`
          );
        }
      }

      throw new ValidationError(
        'INVALID_ORDERS',
        messages.join(' '),
        invalidOrders
      );
    }
  }

  /**
   * Checks if an order is already in an active batch
   * Active = batch status is ENVIADO or EN_BODEGA
   */
  async isOrderInActiveBatch(orderId: string): Promise<boolean> {
    const activeBatchNumbers = await this.getActiveBatchNumbers(orderId);
    return activeBatchNumbers.length > 0;
  }

  /**
   * Gets batch numbers where order is currently active
   * Active = batch status is ENVIADO or EN_BODEGA
   */
  async getActiveBatchNumbers(orderId: string): Promise<string[]> {
    const batchItems = await prisma.exchangeBatchItem.findMany({
      where: {
        orderId,
        batch: {
          status: {
            in: ['ENVIADO', 'EN_BODEGA']
          }
        }
      },
      include: {
        batch: {
          select: {
            batchNumber: true
          }
        }
      }
    });

    return batchItems.map(item => item.batch.batchNumber);
  }
}
