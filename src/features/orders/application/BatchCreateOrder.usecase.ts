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

        // Crear encabezado (OrderReceipt) SOLO si no existe ya este receiptNumber
        let receiptId: string;
        const existingReceipt = await (tx as any).orderReceipt.findUnique({
          where: { receiptNumber }
        });

        const clientName = (client as any).lastName 
          ? `${client.firstName} ${(client as any).lastName}`
          : client.firstName;

        if (existingReceipt) {
          receiptId = existingReceipt.id;
        } else {
          receiptId = crypto.randomUUID();
          
          // Fix: Ensure createdAt has full timestamp even if only date was provided
          let receiptCreatedAt = dto.createdAt ? new Date(dto.createdAt) : new Date();
          // If the date provided is exactly at midnight UTC, it likely came from a date-only input.
          // In that case, we should use the current time but keep the same date if possible,
          // or at least ensure it's not exactly midnight if it's meant for TODAY.
          const now = new Date();
          if (receiptCreatedAt.getHours() === 0 && receiptCreatedAt.getMinutes() === 0 && receiptCreatedAt.toDateString() === now.toDateString()) {
             receiptCreatedAt = now;
          }

          await (tx as any).orderReceipt.create({
            data: {
              id: receiptId,
              receiptNumber,
              clientId: dto.clientId,
              clientName: clientName,
              salesChannel: dto.salesChannel,
              createdAt: receiptCreatedAt,
              transactionDate: dto.transactionDate,
              paymentMethod: dto.paymentMethod,
              bankAccountId: dto.bankAccountId || null,
              transactionReference: dto.initialPayment?.reference || null,
              notes: null,
              createdByName: dto.createdByName || createdBy,
              version: 1
            }
          });
        }

        // Generar consecutivos de recibo para abonos dentro de la transacción
        const lastPayment = await prisma.orderPayment.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { receiptNumber: true }
        });

        let nextPaymentNumber = 1;
        if (lastPayment && lastPayment.receiptNumber && lastPayment.receiptNumber.startsWith('AB')) {
          nextPaymentNumber = parseInt(lastPayment.receiptNumber.replace('AB', '')) + 1;
        }

        const nextPaymentReceiptNumber = () => {
          return `AB${(nextPaymentNumber++).toString().padStart(3, '0')}`;
        };

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
          let rowPaymentId: string | null = null;

          if (orderDto.deposit && Number(orderDto.deposit) > 0) {
            rowPaymentId = crypto.randomUUID();
            paymentsToCreate.push({
              id: rowPaymentId,
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
              id: crypto.randomUUID(),
              amount: Number(dto.creditAmount),
              method: 'CREDITO_CLIENTE',
              receiptNumber: nextPaymentReceiptNumber(),
              description: 'Saldo a favor aplicado'
            });
          }

          // Fix: Ensure Order createdAt has full timestamp
          let orderCreatedAt = dto.createdAt ? new Date(dto.createdAt) : new Date();
          const now = new Date();
          if (orderCreatedAt.getHours() === 0 && orderCreatedAt.getMinutes() === 0 && orderCreatedAt.toDateString() === now.toDateString()) {
             orderCreatedAt = now;
          }

          // Create order in DB (incluye payments anidados)
          const createdOrder = await tx.order.create({
            data: {
              id: orderId,
              receiptNumber,
              receiptId,
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
              clientName: clientName,
              notes: '',
              createdByName: dto.createdByName || createdBy,
              createdAt: orderCreatedAt,
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
            if (!rowPaymentId) {
              throw new Error('Internal error: rowPaymentId missing for deposit row');
            }

            await tx.financialRecord.create({
              data: {
                type: 'PAYMENT',
                source: 'ORDER_PAYMENT',
                movementType: 'INCOME',
                referenceNumber: dto.paymentMethod !== 'EFECTIVO' && dto.initialPayment?.reference
                  ? dto.initialPayment.reference
                  : `REF-INI-${Date.now()}-${i}-${Math.random().toString(36).substring(7)}`,
                amount: rowDeposit,
                date: new Date(),
                clientId: dto.clientId,
                clientName: clientName,
                orderId,
                orderPaymentId: rowPaymentId,
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

          finalResults.push(createdOrder);
        }

        // 8. Update client last order info
        const lastOrder = dto.orders[dto.orders.length - 1];
        await tx.client.update({
          where: { id: dto.clientId },
          data: {
            lastOrderDate: new Date(),
            lastBrandName: lastOrder.brandName
          }
        });

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
