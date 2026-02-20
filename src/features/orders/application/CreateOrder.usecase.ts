import { IOrderRepository } from '../domain/IOrderRepository';
import { Order, OrderStatus } from '../domain/Order.entity';
import { Result } from '../../../shared/domain/Result';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';

export interface CreateOrderDTO {
  salesChannel: string;
  type: string;
  brandId: string;
  total: number;
  paymentMethod: string;
  bankAccountId?: string;
  transactionDate: Date;
  possibleDeliveryDate: Date;
  clientId: string;
  clientName: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    brandId: string;
    brandName: string;
    link?: string;
  }>;
  notes?: string;
  initialPayment: {
    amount: number;
    method: string;
    reference?: string;
  };
}

export class CreateOrderUseCase {
  constructor(
    private orderRepository: IOrderRepository,
    private financialRepository: IFinancialRecordRepository
  ) {}

  async execute(dto: CreateOrderDTO, createdBy: string): Promise<Result<Order>> {
    try {
      // Generate receipt number
      const receiptNumber = await this.orderRepository.generateReceiptNumber();

      // Create order items with IDs
      const items = dto.items.map(item => ({
        id: crypto.randomUUID(),
        ...item
      }));

      // Create initial payment
      const initialPayment = {
        id: crypto.randomUUID(),
        amount: dto.initialPayment.amount,
        method: dto.initialPayment.method,
        reference: dto.initialPayment.reference,
        description: 'Pago inicial',
        createdAt: new Date()
      };

      // Create order entity
      const order = Order.create(
        {
          receiptNumber,
          salesChannel: dto.salesChannel,
          type: dto.type,
          brandId: dto.brandId,
          total: dto.total,
          paymentMethod: dto.paymentMethod,
          bankAccountId: dto.bankAccountId,
          transactionDate: dto.transactionDate,
          possibleDeliveryDate: dto.possibleDeliveryDate,
          status: OrderStatus.POR_RECIBIR,
          clientId: dto.clientId,
          clientName: dto.clientName,
          notes: dto.notes,
          items,
          payments: [initialPayment],
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1
        },
        crypto.randomUUID()
      );

      // Save order
      const savedOrder = await this.orderRepository.save(order);

      // Create financial record if payment > 0
      if (dto.initialPayment.amount > 0 && dto.bankAccountId) {
        await this.financialRepository.createOrderPaymentRecord({
          orderId: savedOrder.id,
          clientId: dto.clientId,
          clientName: dto.clientName,
          amount: dto.initialPayment.amount,
          paymentMethod: dto.initialPayment.method,
          bankAccountId: dto.bankAccountId,
          referenceNumber: dto.initialPayment.reference,
          createdBy
        });
      }

      return Result.ok(savedOrder);
    } catch (error) {
      return Result.fail(error instanceof Error ? error.message : 'Failed to create order');
    }
  }
}
