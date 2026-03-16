import { IOrderRepository } from '../domain/IOrderRepository';
import { Order, OrderStatus } from '../domain/Order.entity';
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientCreditBalance } from '../../../shared/utils/financialValidations';

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
        // ============================================================================
        // OPTIMIZACIÓN: Preparar todos los datos ANTES de ejecutar queries
        // ============================================================================
        
        // 1. Crear/Verificar OrderReceipt
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
          
          let receiptCreatedAt = dto.createdAt ? new Date(dto.createdAt) : new Date();
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

        // 2. Generar consecutivos de abonos (fuera del loop)
        const lastPayment = await prisma.orderPayment.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { receiptNumber: true }
        });

        let nextPaymentNumber = 1;
        if (lastPayment && lastPayment.receiptNumber && lastPayment.receiptNumber.startsWith('AB')) {
          nextPaymentNumber = parseInt(lastPayment.receiptNumber.replace('AB', '')) + 1;
        }

        // ============================================================================
        // OPTIMIZACIÓN: Preparar TODOS los datos en arrays
        // ============================================================================
        const allOrders: any[] = [];
        const allItems: any[] = [];
        const allPayments: any[] = [];
        const allFinancialRecords: any[] = [];
        const paymentIdMap = new Map<string, string>(); // orderId -> paymentId
        let totalBankIncrement = 0;

        let orderCreatedAt = dto.createdAt ? new Date(dto.createdAt) : new Date();
        const now = new Date();
        if (orderCreatedAt.getHours() === 0 && orderCreatedAt.getMinutes() === 0 && orderCreatedAt.toDateString() === now.toDateString()) {
           orderCreatedAt = now;
        }

        for (let i = 0; i < dto.orders.length; i++) {
          const orderDto = dto.orders[i];
          const orderId = crypto.randomUUID();
          
          if (i === 0) parentId = orderId;

          // Preparar Order
          allOrders.push({
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
            version: 1
          });

          // Preparar Items
          orderDto.items.forEach(item => {
            allItems.push({
              id: crypto.randomUUID(),
              orderId: orderId,
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              brandId: orderDto.brandId,
              brandName: orderDto.brandName
            });
          });

          // Preparar Payments (abonos monetarios)
          const rowDeposit = Number(orderDto.deposit || 0);
          if (rowDeposit > 0) {
            const paymentId = crypto.randomUUID();
            paymentIdMap.set(orderId, paymentId);
            
            allPayments.push({
              id: paymentId,
              orderId: orderId,
              amount: rowDeposit,
              method: dto.paymentMethod,
              reference: dto.initialPayment?.reference || undefined,
              receiptNumber: `AB${(nextPaymentNumber++).toString().padStart(3, '0')}`,
              description: `Abono inicial (fila ${i + 1})`,
              createdAt: new Date()
            });

            // Preparar FinancialRecord
            allFinancialRecords.push({
              id: crypto.randomUUID(),
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
              orderId: orderId,
              orderPaymentId: paymentId,
              createdBy,
              notes: `Abono inicial pedido ${receiptNumber} (fila ${i + 1})`,
              bankAccountId: dto.bankAccountId,
              paymentMethod: dto.paymentMethod,
              version: 1
            });

            totalBankIncrement += rowDeposit;
          }

          // Payment de crédito (solo primera iteración)
          if (i === 0 && dto.creditAmount && dto.creditAmount > 0) {
            allPayments.push({
              id: crypto.randomUUID(),
              orderId: orderId,
              amount: Number(dto.creditAmount),
              method: 'CREDITO_CLIENTE',
              receiptNumber: `AB${(nextPaymentNumber++).toString().padStart(3, '0')}`,
              description: 'Saldo a favor aplicado',
              createdAt: new Date()
            });
          }
        }

        // ============================================================================
        // OPTIMIZACIÓN: Ejecutar BULK INSERTS
        // ============================================================================
        
        // 3. Crear todos los Orders de una vez
        await tx.order.createMany({ data: allOrders });

        // 4. Crear todos los Items de una vez
        if (allItems.length > 0) {
          await tx.orderItem.createMany({ data: allItems });
        }

        // 5. Crear todos los Payments de una vez
        if (allPayments.length > 0) {
          await tx.orderPayment.createMany({ data: allPayments });
        }

        // 6. Crear todos los FinancialRecords de una vez
        if (allFinancialRecords.length > 0) {
          await tx.financialRecord.createMany({ data: allFinancialRecords });
        }

        // 7. Actualizar BankAccount UNA SOLA VEZ con el total acumulado
        if (totalBankIncrement > 0 && dto.bankAccountId) {
          // Read account with version
          const bankAccount = await tx.bankAccount.findUnique({
            where: { id: dto.bankAccountId },
            select: { id: true, currentBalance: true, version: true, name: true }
          });

          if (!bankAccount) {
            throw new Error(`Bank account ${dto.bankAccountId} not found`);
          }

          // Validate financial integrity
          validateBankAccountBalance(
            Number(bankAccount.currentBalance),
            totalBankIncrement,
            dto.bankAccountId,
            bankAccount.name
          );

          // Update with optimistic locking
          const result = await tx.bankAccount.updateMany({
            where: {
              id: dto.bankAccountId,
              version: bankAccount.version
            },
            data: { 
              currentBalance: { increment: totalBankIncrement },
              updatedAt: new Date(),
              version: { increment: 1 }
            }
          });

          if (result.count === 0) {
            throw new ConcurrencyError(
              'Bank account was modified by another transaction. Please retry.',
              'BankAccount',
              dto.bankAccountId
            );
          }
        }

        // 8. Aplicar crédito a favor (solo una vez)
        if (dto.creditAmount && dto.creditAmount > 0) {
          const availableCredits = await tx.clientCredit.findMany({
            where: { clientAccount: { clientId: dto.clientId }, status: 'AVAILABLE' },
            select: {
              id: true,
              remainingAmount: true,
              version: true,
              status: true
            },
            orderBy: { createdAt: 'asc' }
          });
          
          let rem = Number(dto.creditAmount);
          const creditsToUpdate: Array<Promise<void>> = [];
          
          for (const cr of availableCredits) {
            if (rem <= 0) break;
            const sub = Math.min(Number(cr.remainingAmount), rem);
            
            // Validate financial integrity
            validateClientCreditBalance(
              Number(cr.remainingAmount),
              sub,
              cr.id
            );

            const newRemaining = Number(cr.remainingAmount) - sub;
            const newStatus = newRemaining <= 0.01 ? 'USED' : 'AVAILABLE';
            
            // Update with optimistic locking
            creditsToUpdate.push((async () => {
              const result = await tx.clientCredit.updateMany({
                where: {
                  id: cr.id,
                  version: cr.version
                },
                data: {
                  remainingAmount: newRemaining,
                  status: newStatus,
                  version: { increment: 1 }
                }
              });

              if (result.count === 0) {
                throw new ConcurrencyError(
                  'Client credit was modified by another transaction. Please retry.',
                  'ClientCredit',
                  cr.id
                );
              }
            })());
            
            rem -= sub;
          }
          
          // Actualizar créditos en paralelo
          await Promise.all(creditsToUpdate);
        }

        // 9. Actualizar cliente
        const lastOrder = dto.orders[dto.orders.length - 1];
        await tx.client.update({
          where: { id: dto.clientId },
          data: {
            lastOrderDate: new Date(),
            lastBrandName: lastOrder.brandName
          }
        });

        // 10. Recuperar los orders creados con sus relaciones para la respuesta
        const createdOrders = await tx.order.findMany({
          where: { id: { in: allOrders.map(o => o.id) } },
          include: {
            items: true,
            payments: true,
            brand: true
          },
          orderBy: { createdAt: 'asc' }
        });

        return createdOrders;
      }, {
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
