import { IOrderRepository } from '../domain/IOrderRepository';
import { Order, OrderStatus } from '../domain/Order.entity';
import { Result } from '../../../shared/domain/Result';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { IBankAccountRepository } from '../../financial/domain/IBankAccountRepository';
import { FinancialRecord } from '../../financial/domain/FinancialRecord.entity';
import { prisma } from '../../../lib/prisma';

export interface CreateOrderDTO {
  receiptNumber?: string; // Optional manual receipt number
  salesChannel: string;
  type: string;
  brandId: string;
  brandName: string;
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
    private financialRepository: IFinancialRecordRepository,
    private bankAccountRepository: IBankAccountRepository
  ) { }

  async execute(dto: CreateOrderDTO, createdBy: string): Promise<Result<Order>> {
    try {
      // Validate required fields
      if (!dto.clientId || !dto.brandId) {
        return Result.fail('Client ID and Brand ID are required');
      }

      if (!dto.initialPayment || dto.initialPayment.amount === undefined) {
        return Result.fail('Initial payment information is required');
      }

      // Generate or use manual receipt number
      const receiptNumber = dto.receiptNumber || await this.orderRepository.generateReceiptNumber();

      // Create order items with IDs
      const items = dto.items.map(item => ({
        id: crypto.randomUUID(),
        ...item
      }));

      // Create initial payment entity for the order
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
          brandName: dto.brandName,
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

      // Create financial record if there is an initial payment
      if (dto.initialPayment.amount > 0 && dto.bankAccountId) {
        // Check for duplicate reference in non-cash payments
        if (dto.initialPayment.method !== 'EFECTIVO' && dto.initialPayment.reference) {
          const whereClause: any = {
            paymentMethod: dto.initialPayment.method,
            referenceNumber: dto.initialPayment.reference
          };
          if (dto.initialPayment.method === 'CHEQUE') {
            whereClause.bankAccountId = dto.bankAccountId;
          }
          const existingRecord = await prisma.financialRecord.findFirst({
            where: whereClause
          });

          if (existingRecord) {
            return Result.fail(`La referencia ${dto.initialPayment.reference} ya fue utilizada en otro pago de tipo ${dto.initialPayment.method}.`);
          }
        }

        const referenceNumber = dto.initialPayment.method !== 'EFECTIVO' && dto.initialPayment.reference
          ? dto.initialPayment.reference
          : await this.financialRepository.generateReferenceNumber();

        const financialRecord = FinancialRecord.create({
          type: 'PAYMENT',
          source: 'ORDER_PAYMENT',
          movementType: 'INCOME',
          referenceNumber,
          amount: dto.initialPayment.amount,
          date: new Date(),
          clientId: dto.clientId,
          clientName: dto.clientName,
          orderId: savedOrder.id,
          createdBy,
          notes: `Abono inicial pedido ${receiptNumber}`,
          bankAccountId: dto.bankAccountId,
          paymentMethod: dto.initialPayment.method as any,
          createdAt: new Date(),
          version: 1
        });

        await this.financialRepository.save(financialRecord);

        // Update BankAccount balance
        await this.bankAccountRepository.updateBalance(
          dto.bankAccountId,
          dto.initialPayment.amount,
          'INCOME'
        );
      }

      return Result.ok(savedOrder);
    } catch (error) {
      console.error('CreateOrderUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Failed to create order');
    }
  }
}
