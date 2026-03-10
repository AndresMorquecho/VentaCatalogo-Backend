import { IOrderRepository } from '../domain/IOrderRepository';
import { Order, OrderStatus } from '../domain/Order.entity';
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';

export interface BatchCreateOrderDTO {
  receiptNumber: string;
  clientId: string;
  salesChannel: string;
  createdAt: Date;
  paymentMethod: string;
  bankAccountId?: string;
  transactionDate: Date;
  createdByName?: string;
  initialPayment: {
    amount: number;
    method: string;
    reference?: string;
  };
  creditAmount?: number;
  orders: Array<{
    brandId: string;
    brandName: string;
    total: number;
    type: string;
    possibleDeliveryDate: Date;
    items: Array<{
      productName: string;
      quantity: number;
      unitPrice: number;
    }>;
  }>;
}

export class BatchCreateOrderUseCase {
  constructor(private orderRepository: IOrderRepository) {}

  async execute(dto: BatchCreateOrderDTO, createdBy: string): Promise<Result<Order[]>> {
    try {
      if (!dto.orders || dto.orders.length === 0) {
        return Result.fail('No orders provided in batch');
      }

      // 1. Pre-fetch shared data
      const [client, lastClosure] = await Promise.all([
        prisma.client.findUnique({ where: { id: dto.clientId } }),
        prisma.cashClosure.findFirst({ orderBy: { toDate: 'desc' } })
      ]);

      if (!client) return Result.fail('Cliente no encontrado');
      if (client.isBlocked) return Result.fail('La empresaria está bloqueada');
      
      if (lastClosure && new Date(dto.transactionDate) <= lastClosure.toDate) {
        return Result.fail('Periodo de caja cerrado');
      }

      // 2. Validate all brands
      const brandIds = [...new Set(dto.orders.map(o => o.brandId))];
      const brands = await prisma.brand.findMany({
        where: { id: { in: brandIds } }
      });

      for (const brandId of brandIds) {
        const brand = brands.find(b => b.id === brandId);
        if (!brand || !brand.isActive) {
          return Result.fail(`La marca ${brand?.name || brandId} no está activa`);
        }
      }

      const receiptNumber = dto.receiptNumber || await this.orderRepository.generateReceiptNumber();

      // 3. Prepare all entities
      let parentId: string | undefined = undefined;
      const createdOrders: Order[] = [];

      const resultOrders = await prisma.$transaction(async (tx) => {
        const finalResults = [];

        for (let i = 0; i < dto.orders.length; i++) {
          const orderDto = dto.orders[i];
          const orderId = crypto.randomUUID();
          
          if (i === 0) parentId = orderId;

          // Prepare items
          const itemsData = orderDto.items.map(item => ({
            id: crypto.randomUUID(),
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            brandId: orderDto.brandId,
            brandName: orderDto.brandName
          }));

          // Create order in DB
          const createdOrder = await tx.order.create({
            data: {
              id: orderId,
              receiptNumber,
              salesChannel: dto.salesChannel,
              type: orderDto.type,
              brandId: orderDto.brandId,
              total: orderDto.total,
              paymentMethod: dto.paymentMethod,
              bankAccountId: dto.bankAccountId || null,
              transactionDate: dto.transactionDate,
              possibleDeliveryDate: orderDto.possibleDeliveryDate,
              status: OrderStatus.POR_RECIBIR,
              parentOrderId: i > 0 ? parentId : null,
              clientId: dto.clientId,
              clientName: client.firstName,
              notes: '',
              createdByName: dto.createdByName || createdBy,
              createdAt: dto.createdAt || new Date(),
              version: 1,
              items: {
                create: itemsData
              }
            },
            include: {
              items: true,
              payments: true,
              brand: true
            }
          });

          // Handle payments ONLY for the first order (Parent)
          if (i === 0) {
            // Handle Initial Payment
            if (dto.initialPayment.amount > 0) {
              const lastPayment = await (tx.orderPayment as any).findFirst({
                where: { receiptNumber: { startsWith: 'REC-ABO-' } },
                orderBy: { createdAt: 'desc' }
              });

              let nextNum = 1;
              if (lastPayment && (lastPayment as any).receiptNumber) {
                const match = (lastPayment as any).receiptNumber.match(/(\d+)$/);
                if (match) nextNum = parseInt(match[1]) + 1;
              }
              const payReceiptNumber = `REC-ABO-${nextNum.toString().padStart(6, '0')}`;

              await (tx.orderPayment as any).create({
                data: {
                  orderId,
                  amount: dto.initialPayment.amount,
                  method: dto.initialPayment.method,
                  reference: dto.initialPayment.reference,
                  receiptNumber: payReceiptNumber,
                  description: 'Abono inicial'
                }
              });

              // Financial Record
              await tx.financialRecord.create({
                data: {
                  type: 'PAYMENT',
                  source: 'ORDER_PAYMENT',
                  movementType: 'INCOME',
                  referenceNumber: dto.initialPayment.method !== 'EFECTIVO' && dto.initialPayment.reference
                    ? dto.initialPayment.reference
                    : `REF-INI-${Date.now()}`,
                  amount: dto.initialPayment.amount,
                  date: new Date(),
                  clientId: dto.clientId,
                  clientName: client.firstName,
                  orderId,
                  createdBy,
                  notes: `Abono inicial pedido ${receiptNumber}`,
                  bankAccountId: dto.bankAccountId!,
                  paymentMethod: dto.initialPayment.method,
                  version: 1
                }
              });

              // Bank Balance
              await tx.bankAccount.update({
                where: { id: dto.bankAccountId! },
                data: { currentBalance: { increment: dto.initialPayment.amount }, version: { increment: 1 } }
              });
            }

            // Handle Credit Usage
            if (dto.creditAmount && dto.creditAmount > 0) {
               // ... same credit logic ...
               // To keep it short, I'll copy the refined logic from the single create order
               const lastCreditPayment = await (tx.orderPayment as any).findFirst({
                where: { receiptNumber: { startsWith: 'REC-ABO-' } },
                orderBy: { createdAt: 'desc' }
              });
              let nextCNum = 1;
              if (lastCreditPayment && (lastCreditPayment as any).receiptNumber) {
                const m = (lastCreditPayment as any).receiptNumber.match(/(\d+)$/);
                if (m) nextCNum = parseInt(m[1]) + 1;
              }

              await (tx.orderPayment as any).create({
                data: {
                  orderId,
                  amount: dto.creditAmount,
                  method: 'CREDITO_CLIENTE',
                  receiptNumber: `REC-ABO-${nextCNum.toString().padStart(6, '0')}`,
                  description: 'Saldo a favor aplicado'
                }
              });

              // Credit Reversion logic
              const availableCredits = await tx.clientCredit.findMany({
                where: { clientAccount: { clientId: dto.clientId }, status: 'AVAILABLE' },
                orderBy: { createdAt: 'asc' }
              });
              let rem = dto.creditAmount;
              for (const cr of availableCredits) {
                if (rem <= 0) break;
                const sub = Math.min(Number(cr.remainingAmount), rem);
                await tx.clientCredit.update({
                  where: { id: cr.id },
                  data: {
                    remainingAmount: { decrement: sub },
                    status: Number(cr.remainingAmount) - sub <= 0.01 ? 'USED' : 'AVAILABLE'
                  }
                });
                rem -= sub;
              }
            }
          }

          finalResults.push(createdOrder);
        }

        return finalResults;
      });

      // Map to Domain Entities
      const domainOrders = resultOrders.map(raw => Order.create({
          receiptNumber: raw.receiptNumber,
          salesChannel: raw.salesChannel,
          type: raw.type,
          brandId: raw.brandId,
          brandName: (raw as any).brand?.name || 'Sin marca',
          total: Number(raw.total),
          paymentMethod: raw.paymentMethod,
          bankAccountId: raw.bankAccountId || undefined,
          transactionDate: raw.transactionDate,
          possibleDeliveryDate: raw.possibleDeliveryDate,
          status: raw.status as any,
          parentOrderId: raw.parentOrderId || undefined,
          clientId: raw.clientId,
          clientName: raw.clientName,
          notes: raw.notes || undefined,
          items: raw.items.map((i: any) => ({
            id: i.id,
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: Number(i.unitPrice),
            brandId: i.brandId,
            brandName: i.brandName
          })),
          payments: [], // Optionally fetch them if needed
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
          version: raw.version
      }, raw.id));

      return Result.ok(domainOrders);
    } catch (error) {
      console.error('BatchCreateOrderUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Batch creation failed');
    }
  }
}
