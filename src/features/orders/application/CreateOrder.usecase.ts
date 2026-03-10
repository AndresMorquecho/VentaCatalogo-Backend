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
  parentOrderId?: string;
  orderNumber?: string;
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

      // Pre-fetch all necessary checks in parallel to reduce sequential round-trips
      const [brand, client, lastClosure, generatedReceiptNumber] = await Promise.all([
        prisma.brand.findUnique({ where: { id: dto.brandId } }),
        prisma.client.findUnique({ where: { id: dto.clientId } }),
        prisma.cashClosure.findFirst({ orderBy: { toDate: 'desc' } }),
        dto.receiptNumber ? Promise.resolve(dto.receiptNumber) : this.orderRepository.generateReceiptNumber()
      ]);

      if (!brand || !brand.isActive) {
        return Result.fail(`La marca ${brand?.name || ''} no está activa y no puede recibir pedidos.`);
      }

      if (!client) {
        return Result.fail('Cliente no encontrado');
      }

      if (client.isBlocked) {
        return Result.fail('La empresaria está bloqueada y no puede realizar nuevos pedidos.');
      }

      if (client.paymentPreference === 'SOLO_CONTADO') {
        const totalAbono = (dto.initialPayment.amount || 0) + (dto.creditAmount || 0);
        if (totalAbono < dto.total) {
          return Result.fail('Esta empresaria tiene restricción de SOLO CONTADO. El abono debe ser igual al total del pedido.');
        }
      }

      if (!dto.initialPayment || dto.initialPayment.amount === undefined) {
        return Result.fail('Initial payment information is required');
      }

      if (lastClosure && new Date(dto.transactionDate) <= lastClosure.toDate) {
        return Result.fail('No se puede crear un pedido con fecha de transacción en un periodo de caja ya cerrado.');
      }

      const receiptNumber = generatedReceiptNumber;

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
          payments: [],
          parentOrderId: dto.parentOrderId,
          orderNumber: dto.orderNumber,
          createdAt: dto.createdAt ? new Date(dto.createdAt) : new Date(),
          updatedAt: new Date(),
          version: 1
        },
        crypto.randomUUID()
      );


      // Execute everything in a transaction for atomicity
      const savedOrder = await prisma.$transaction(async (tx) => {
        // 1. Get base receipt number for payments once inside the transaction
        const lastPayment = await (tx.orderPayment as any).findFirst({
          where: { receiptNumber: { startsWith: 'REC-ABO-' } },
          orderBy: { createdAt: 'desc' }
        });

        let nextPaymentNumber = 1;
        if (lastPayment && (lastPayment as any).receiptNumber) {
          const match = (lastPayment as any).receiptNumber.match(/(\d+)$/);
          if (match) nextPaymentNumber = parseInt(match[1]) + 1;
        }

        const paymentsToCreate = [];
        const financialRecordsToCreate = [];

        // 2. Prepare Initial Payment data
        if (dto.initialPayment.amount > 0) {
          if (!dto.bankAccountId) {
            throw new Error('Bank account is required for initial payment');
          }

          const initialPaymentReceiptNumber = `REC-ABO-${(nextPaymentNumber++).toString().padStart(6, '0')}`;
          
          paymentsToCreate.push({
            amount: dto.initialPayment.amount,
            method: dto.initialPayment.method,
            reference: dto.initialPayment.reference,
            receiptNumber: initialPaymentReceiptNumber,
            description: 'Abono inicial'
          });

          financialRecordsToCreate.push({
            type: 'PAYMENT',
            source: 'ORDER_PAYMENT',
            movementType: 'INCOME',
            referenceNumber: dto.initialPayment.method !== 'EFECTIVO' && dto.initialPayment.reference
              ? dto.initialPayment.reference
              : `REF-INI-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            amount: dto.initialPayment.amount,
            date: new Date(),
            clientId: dto.clientId,
            clientName: dto.clientName,
            createdBy,
            notes: `Abono inicial pedido ${receiptNumber}`,
            bankAccountId: dto.bankAccountId,
            paymentMethod: dto.initialPayment.method,
            version: 1
          });
        }

        // 3. Prepare Credit Usage data
        if (dto.creditAmount && dto.creditAmount > 0) {
          const creditPaymentReceiptNumber = `REC-ABO-${(nextPaymentNumber++).toString().padStart(6, '0')}`;
          
          paymentsToCreate.push({
            amount: dto.creditAmount,
            method: 'CREDITO_CLIENTE',
            receiptNumber: creditPaymentReceiptNumber,
            description: 'Saldo a favor aplicado'
          });

          let creditBankAccountId = dto.bankAccountId;
          if (!creditBankAccountId || creditBankAccountId === 'default') {
            const cashAcc = await tx.bankAccount.findFirst({ where: { type: 'CASH' } });
            if (cashAcc) creditBankAccountId = cashAcc.id;
          }

          financialRecordsToCreate.push({
            type: 'PAYMENT',
            source: 'ORDER_PAYMENT',
            movementType: 'INCOME',
            referenceNumber: `REF-CRED-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            amount: dto.creditAmount,
            date: new Date(),
            clientId: dto.clientId,
            clientName: dto.clientName,
            createdBy,
            notes: `Saldo a favor aplicado al pedido ${receiptNumber}`,
            bankAccountId: creditBankAccountId!,
            paymentMethod: 'CREDITO_CLIENTE',
            version: 1
          });
        }

        // 4. Create order with items and payments in ONE call
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
            parentOrderId: rawOrder.parentOrderId,
            orderNumber: (rawOrder as any).orderNumber,
            clientId: rawOrder.clientId,
            clientName: rawOrder.clientName,
            notes: rawOrder.notes,
            createdByName: dto.createdByName || createdBy || null,
            createdAt: rawOrder.createdAt,
            version: rawOrder.version,
            items: { create: order.items },
            payments: paymentsToCreate.length > 0 ? { create: paymentsToCreate } : undefined
          } as any,
          include: {
            items: true,
            payments: true,
            brand: true
          }
        });

        // 5. Handle Financial Records and Bank Account update in parallel
        const financialAndBankOps = [];
        
        // Add order link to financial records and add to ops
        for (const frData of financialRecordsToCreate) {
          financialAndBankOps.push(tx.financialRecord.create({
            data: { ...frData, orderId: createdOrder.id }
          }));
        }

        // Bank account balance update
        if (dto.initialPayment.amount > 0 && dto.bankAccountId) {
          financialAndBankOps.push(tx.bankAccount.update({
            where: { id: dto.bankAccountId },
            data: {
              currentBalance: { increment: dto.initialPayment.amount },
              version: { increment: 1 }
            }
          }));
        }

        // 6. Handle Credit Reversion if applicable
        if (dto.creditAmount && dto.creditAmount > 0) {
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

            financialAndBankOps.push(tx.clientCredit.update({
              where: { id: credit.id },
              data: {
                remainingAmount: { decrement: amountToSubtract },
                status: Number(credit.remainingAmount) - amountToSubtract <= 0.01 ? 'USED' : 'AVAILABLE'
              }
            }));
            remainingToSubtract -= amountToSubtract;
          }

          if (remainingToSubtract > 0.01) {
            throw new Error(`Saldo a favor insuficiente para cubrir $${dto.creditAmount.toFixed(2)}`);
          }
        }

        await Promise.all(financialAndBankOps);

        return createdOrder;
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
        parentOrderId: savedOrder.parentOrderId || undefined,
        orderNumber: (savedOrder as any).orderNumber || undefined,
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
          receiptNumber: (p as any).receiptNumber || undefined,
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
