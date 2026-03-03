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
  createdByName?: string; // Username del que crea el pedido
  createdAt?: Date; // Optional manual registration date
  initialPayment: {
    amount: number;
    method: string;
    reference?: string;
  };
  creditAmount?: number;
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

      // Validate brand is active
      const brand = await prisma.brand.findUnique({
        where: { id: dto.brandId }
      });

      if (!brand || !brand.isActive) {
        return Result.fail(`La marca ${brand?.name || ''} no está activa y no puede recibir pedidos.`);
      }

      if (!dto.initialPayment || dto.initialPayment.amount === undefined) {
        return Result.fail('Initial payment information is required');
      }

      // Fix 3: Validate closed period for Go-Live Safety
      const lastClosure = await prisma.cashClosure.findFirst({
        orderBy: { toDate: 'desc' }
      });

      if (lastClosure && new Date(dto.transactionDate) <= lastClosure.toDate) {
        return Result.fail('No se puede crear un pedido con fecha de transacción en un periodo de caja ya cerrado.');
      }

      // Generate or use manual receipt number
      const receiptNumber = dto.receiptNumber || await this.orderRepository.generateReceiptNumber();

      // Create order items with IDs
      const items = dto.items.map(item => ({
        id: crypto.randomUUID(),
        ...item
      }));

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
          payments: [], // Will be populated in transaction
          createdAt: dto.createdAt ? new Date(dto.createdAt) : new Date(),
          updatedAt: new Date(),
          version: 1
        },
        crypto.randomUUID()
      );


      // Execute everything in a transaction for atomicity
      const savedOrder = await prisma.$transaction(async (tx) => {
        // Save order and items
        const rawOrder = order.toJSON();
        const createdOrder = await tx.order.create({
          data: {
            id: rawOrder.id,
            receiptNumber: rawOrder.receiptNumber,
            salesChannel: rawOrder.salesChannel,
            type: rawOrder.type,
            brandId: rawOrder.brandId,
            total: rawOrder.total,
            paymentMethod: rawOrder.paymentMethod,
            bankAccountId: rawOrder.bankAccountId,
            transactionDate: rawOrder.transactionDate,
            possibleDeliveryDate: rawOrder.possibleDeliveryDate,
            status: rawOrder.status as any,
            clientId: rawOrder.clientId,
            clientName: rawOrder.clientName,
            notes: rawOrder.notes,
            createdByName: dto.createdByName || createdBy || null,
            createdAt: rawOrder.createdAt,
            version: rawOrder.version,
            items: {

              create: order.items
            }
          },
          include: {
            items: true,
            payments: true,
            brand: true
          }
        });

        // Handle initial payment (Cash/Transfer/etc)
        if (dto.initialPayment.amount > 0) {
          if (!dto.bankAccountId) {
            throw new Error('Bank account is required for initial payment');
          }

          // Reference validation
          if (dto.initialPayment.method !== 'EFECTIVO' && dto.initialPayment.reference) {
            const existingRecord = await tx.financialRecord.findFirst({
              where: { referenceNumber: dto.initialPayment.reference }
            });
            if (existingRecord) throw new Error(`La referencia ${dto.initialPayment.reference} ya fue utilizada en otro pago (${existingRecord.paymentMethod}).`);
          }

          const referenceNumber = dto.initialPayment.method !== 'EFECTIVO' && dto.initialPayment.reference
            ? dto.initialPayment.reference
            : `REF-INI-${Date.now()}`;

          // Create order payment record
          await tx.orderPayment.create({
            data: {
              orderId: createdOrder.id,
              amount: dto.initialPayment.amount,
              method: dto.initialPayment.method,
              reference: dto.initialPayment.reference,
              description: 'Abono inicial'
            }
          });

          // Create financial record
          await tx.financialRecord.create({
            data: {
              type: 'PAYMENT',
              source: 'ORDER_PAYMENT',
              movementType: 'INCOME',
              referenceNumber,
              amount: dto.initialPayment.amount,
              date: new Date(),
              clientId: dto.clientId,
              clientName: dto.clientName,
              orderId: createdOrder.id,
              createdBy,
              notes: `Abono inicial pedido ${receiptNumber}`,
              bankAccountId: dto.bankAccountId,
              paymentMethod: dto.initialPayment.method,
              version: 1
            }
          });

          // Update BankAccount balance
          await tx.bankAccount.update({
            where: { id: dto.bankAccountId },
            data: {
              currentBalance: { increment: dto.initialPayment.amount },
              version: { increment: 1 }
            }
          });
        }

        // Handle separate credit usage
        if (dto.creditAmount && dto.creditAmount > 0) {
          // Create credit payment in order
          await tx.orderPayment.create({
            data: {
              orderId: createdOrder.id,
              amount: dto.creditAmount,
              method: 'CREDITO_CLIENTE',
              description: 'Saldo a favor aplicado'
            }
          });

          // Find a fallback account if none provided to avoid foreign key errors for CREDIT
          let creditBankAccountId = dto.bankAccountId; // from the dto if exists
          if (!creditBankAccountId || creditBankAccountId === 'default') {
            const cashAcc = await tx.bankAccount.findFirst({ where: { type: 'CASH' } });
            if (cashAcc) creditBankAccountId = cashAcc.id;
          }

          // Create financial record for credit
          await tx.financialRecord.create({
            data: {
              type: 'PAYMENT',
              source: 'ORDER_PAYMENT',
              movementType: 'INCOME',
              referenceNumber: `REF-CRED-${Date.now()}`,
              amount: dto.creditAmount,
              date: new Date(),
              clientId: dto.clientId,
              clientName: dto.clientName,
              orderId: createdOrder.id,
              createdBy,
              notes: `Saldo a favor aplicado al pedido ${receiptNumber}`,
              bankAccountId: creditBankAccountId!,
              paymentMethod: 'CREDITO_CLIENTE',
              version: 1
            }
          });

          // REDUCE CLIENT CREDITS
          const availableCredits = await tx.clientCredit.findMany({
            where: {
              clientAccount: { clientId: dto.clientId },
              status: 'AVAILABLE'
            },
            orderBy: { createdAt: 'asc' }
          });

          let remainingToSubtract = dto.creditAmount;
          for (const credit of availableCredits) {
            if (remainingToSubtract <= 0) break;
            const amountToSubtract = Math.min(Number(credit.remainingAmount), remainingToSubtract);

            await tx.clientCredit.update({
              where: { id: credit.id },
              data: {
                remainingAmount: { decrement: amountToSubtract },
                status: Number(credit.remainingAmount) - amountToSubtract <= 0.01 ? 'USED' : 'AVAILABLE'
              }
            });
            remainingToSubtract -= amountToSubtract;
          }

          if (remainingToSubtract > 0.01) {
            throw new Error(`Saldo a favor insuficiente para cubrir $${dto.creditAmount.toFixed(2)}`);
          }
        }

        // Fetch final state for mapping
        return await tx.order.findUnique({
          where: { id: createdOrder.id },
          include: { items: true, payments: true, brand: true }
        });
      });

      if (!savedOrder) throw new Error("Failed to retrieve saved order");

      // Map back to Domain Entity
      const finalOrder = Order.create({
        receiptNumber: savedOrder.receiptNumber,
        salesChannel: savedOrder.salesChannel,
        type: savedOrder.type,
        brandId: savedOrder.brandId,
        brandName: (savedOrder as any).brand?.name || 'Sin marca',
        total: Number(savedOrder.total),
        paymentMethod: savedOrder.paymentMethod,
        bankAccountId: savedOrder.bankAccountId || undefined,
        transactionDate: savedOrder.transactionDate,
        possibleDeliveryDate: savedOrder.possibleDeliveryDate,
        status: savedOrder.status as any,
        clientId: savedOrder.clientId,
        clientName: savedOrder.clientName,
        notes: savedOrder.notes || undefined,
        items: savedOrder.items.map((i: any) => ({
          id: i.id,
          productName: i.productName,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          brandId: i.brandId,
          brandName: i.brandName
        })),
        payments: savedOrder.payments.map((p: any) => ({
          id: p.id,
          amount: Number(p.amount),
          method: p.method,
          reference: p.reference || undefined,
          description: p.description || undefined,
          createdAt: p.createdAt
        })),
        createdAt: savedOrder.createdAt,
        updatedAt: savedOrder.updatedAt,
        version: savedOrder.version
      }, savedOrder.id);

      return Result.ok(finalOrder);
    } catch (error) {
      console.error('CreateOrderUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Failed to create order');
    }
  }
}
