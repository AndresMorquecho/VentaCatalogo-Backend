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
    deposit?: number; // Añadir esto
    orderNumber?: string; // Añadir esto
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

      const resultOrders = await prisma.$transaction(async (tx) => {
        const finalResults = [];

        // Generar consecutivos de recibo para abonos dentro de la transacción
        const lastPayment = await (tx.orderPayment as any).findFirst({
          where: { receiptNumber: { startsWith: 'REC-ABO-' } },
          orderBy: { createdAt: 'desc' }
        });

        let nextPayNum = 1;
        if (lastPayment && (lastPayment as any).receiptNumber) {
          const match = (lastPayment as any).receiptNumber.match(/(\d+)$/);
          if (match) nextPayNum = parseInt(match[1], 10) + 1;
        }

        const nextPaymentReceiptNumber = () => `REC-ABO-${(nextPayNum++).toString().padStart(6, '0')}`;

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

          // Preparar pagos por fila (abonos) para crear anidado y que venga en la respuesta
          const paymentsToCreate: any[] = [];

          if (orderDto.deposit && Number(orderDto.deposit) > 0) {
            paymentsToCreate.push({
              amount: Number(orderDto.deposit),
              method: dto.paymentMethod,
              reference: dto.initialPayment?.reference || undefined,
              receiptNumber: nextPaymentReceiptNumber(),
              description: `Abono inicial (fila ${i + 1})`
            });
          }

          // Crédito aplicado (solo una vez al parent)
          if (i === 0 && dto.creditAmount && dto.creditAmount > 0) {
            paymentsToCreate.push({
              amount: Number(dto.creditAmount),
              method: 'CREDITO_CLIENTE',
              receiptNumber: nextPaymentReceiptNumber(),
              description: 'Saldo a favor aplicado'
            });
          }

          // Create order in DB (incluye payments anidados)
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
              orderNumber: orderDto.orderNumber || null,
              clientId: dto.clientId,
              clientName: client.firstName,
              notes: '',
              createdByName: dto.createdByName || createdBy,
              createdAt: dto.createdAt || new Date(),
              version: 1,
              items: {
                create: itemsData
              },
              payments: paymentsToCreate.length > 0 ? { create: paymentsToCreate } : undefined
            },
            include: {
              items: true,
              payments: true,
              brand: true
            }
          });

          // Registrar movimiento bancario y financialRecord SOLO para abonos monetarios (no para crédito)
          const rowDeposit = Number(orderDto.deposit || 0);
          if (rowDeposit > 0) {
            if (!dto.bankAccountId) {
              throw new Error('Bank account is required when deposit > 0');
            }

            await tx.financialRecord.create({
              data: {
                type: 'PAYMENT',
                source: 'ORDER_PAYMENT',
                movementType: 'INCOME',
                referenceNumber: dto.paymentMethod !== 'EFECTIVO' && dto.initialPayment?.reference
                  ? dto.initialPayment.reference
                  : `REF-INI-${Date.now()}-${i}`,
                amount: rowDeposit,
                date: new Date(),
                clientId: dto.clientId,
                clientName: client.firstName,
                orderId,
                createdBy,
                notes: `Abono inicial pedido ${receiptNumber} (fila ${i + 1})`,
                bankAccountId: dto.bankAccountId,
                paymentMethod: dto.paymentMethod,
                version: 1
              }
            });

            await tx.bankAccount.update({
              where: { id: dto.bankAccountId },
              data: { currentBalance: { increment: rowDeposit }, version: { increment: 1 } }
            });
          }

          // Aplicar crédito a favor solo una vez
          if (i === 0 && dto.creditAmount && dto.creditAmount > 0) {
            const availableCredits = await tx.clientCredit.findMany({
              where: { clientAccount: { clientId: dto.clientId }, status: 'AVAILABLE' },
              orderBy: { createdAt: 'asc' }
            });
            let rem = Number(dto.creditAmount);
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

          finalResults.push(createdOrder); // Insertar aquí
        }

        return finalResults;
      }, {
        // Neon / pooled connections pueden cerrar transacciones interactivas si demoran.
        // Subimos límites para batches de varias filas con movimientos financieros.
        maxWait: 20_000,
        timeout: 60_000
      });

      // Map to Domain Entities
      const domainOrders = resultOrders.map(raw => Order.create({
          receiptNumber: raw.receiptNumber,
          salesChannel: raw.salesChannel,
          type: raw.type,
          brandId: raw.brandId,
          brandName: (raw as any).brand?.name || 'Sin marca',
          total: raw.total ? Number(raw.total) : 0,
          paymentMethod: raw.paymentMethod,
          bankAccountId: raw.bankAccountId || undefined,
          transactionDate: raw.transactionDate,
          possibleDeliveryDate: raw.possibleDeliveryDate,
          status: raw.status as any,
          parentOrderId: raw.parentOrderId || undefined,
          orderNumber: raw.orderNumber || undefined,
          clientId: raw.clientId,
          clientName: raw.clientName,
          notes: raw.notes || undefined,
          items: raw.items.map((i: any) => ({
            id: i.id,
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice ? Number(i.unitPrice) : 0,
            brandId: i.brandId,
            brandName: i.brandName
          })),
          payments: (raw.payments || []).map((p: any) => ({
            id: p.id,
            amount: p.amount ? Number(p.amount) : 0,
            method: p.method,
            reference: p.reference || undefined,
            description: p.description || undefined,
            createdAt: p.createdAt
          })),
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
