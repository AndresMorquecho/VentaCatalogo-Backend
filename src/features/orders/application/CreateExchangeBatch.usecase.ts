import { prisma } from '../../../lib/prisma';
import { ValidationService } from './ValidationService';
import { getNextSequence } from '../../../shared/utils/SequenceGenerator';

export interface ExchangeBatchItemInput {
  orderId: string;
  notes?: string;
}

export interface CreateExchangeBatchDTO {
  trackingGuide?: string;
  notes?: string;
  createdByName?: string;
  items: ExchangeBatchItemInput[];
}

function calcPaid(payments: { method: string; amount: any }[]): number {
  return payments
    .reduce((sum, p) => sum + Number(p.amount), 0);
}

async function generateOrderNumber(tx: any): Promise<string> {
  const year = new Date().getFullYear();
  const count = await tx.order.count({
    where: {
      orderNumber: { startsWith: `PD-${year}` }
    }
  });
  return `PD-${year}-${String(count + 1).padStart(3, '0')}`;
}

export class CreateExchangeBatchUseCase {
  private validationService: ValidationService;

  constructor() {
    this.validationService = new ValidationService();
  }

  async execute(dto: CreateExchangeBatchDTO) {
    if (!dto.items || dto.items.length === 0) {
      throw new Error('El lote debe tener al menos un pedido');
    }

    const orderIds = dto.items.map((i) => i.orderId);

    // Task 4.1: Validate orders using ValidationService
    await this.validationService.validateOrdersForBatch(orderIds);

    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: { 
        payments: true,
        brand: true
      },
    });

    if (orders.length !== orderIds.length) {
      throw new Error('Uno o más pedidos no fueron encontrados');
    }

    const batchNumber = await getNextSequence('LT-', 'EXCHANGE');
    console.log(`[CreateExchangeBatch] Creating batch ${batchNumber} with ${orders.length} orders`);

    // Get default bank account for fallback
    const defaultAccount = await prisma.bankAccount.findFirst({
      where: { type: 'CASH', isActive: true }
    });
    if (!defaultAccount) {
      throw new Error('No se encontró una cuenta de caja activa para procesar la transacción');
    }

    return await prisma.$transaction(async (tx) => {
      // --- 🔒 CONCURRENCY & DUPLICATE CHECK ---
      
      // 1. Validate Tracking Guide Uniqueness if provided
      if (dto.trackingGuide) {
        const existingBatch = await tx.exchangeBatch.findFirst({
          where: { trackingGuide: dto.trackingGuide }
        });
        if (existingBatch) {
          throw new Error(`La guía "${dto.trackingGuide}" ya existe y fue registrada por otro usuario en el lote ${existingBatch.batchNumber}. Por favor verifica el número.`);
        }
      }

      // 2. Validate Orders status AGAIN inside transaction to prevent race conditions
      const currentOrders = await tx.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, receiptNumber: true, status: true }
      });

      for (const o of currentOrders) {
        if (o.status !== 'ENTREGADO') {
          throw new Error(`Conflicto de Concurrencia: El pedido ${o.receiptNumber} ya no está disponible para cambio (Estado actual: ${o.status}). Es posible que otro usuario ya lo haya procesado.`);
        }
      }

      // Task 4.2: Create batch with status POR_ENVIAR
      const batch = await tx.exchangeBatch.create({
        data: {
          batchNumber,
          trackingGuide: dto.trackingGuide || null,
          notes: dto.notes || null,
          createdByName: dto.createdByName || null,
          status: 'POR_ENVIAR',
          items: {
            create: orders.map((order) => {
              const paid = calcPaid(order.payments);
              const pending = Math.max(0, Number(order.total) - paid);
              const itemInput = dto.items.find((i) => i.orderId === order.id);
              return {
                orderId: order.id,
                clientId: order.clientId,
                clientName: order.clientName,
                receiptNumber: order.receiptNumber,
                orderTotal: order.total,
                invoiceTotal: order.realInvoiceTotal || null,
                paidAmount: paid,
                pendingAmount: pending,
                notes: itemInput?.notes || null,
              };
            }),
          },
        },
        include: { items: true },
      });

      // Process each order in the batch
      for (const order of orders) {
        console.log(`[CreateExchangeBatch] Processing order ${order.receiptNumber} (${order.id})`);
        
        // Task 4.3: Update original order status to ENVIADO_A_CAMBIO within transaction
        await tx.order.update({
          where: { id: order.id },
          data: { 
            status: 'ENVIADO_A_CAMBIO',
            updatedAt: new Date()
          }
        });

        // 2. Create Shadow Order for Reception
        const paid = calcPaid(order.payments);
        const revReceipt = `${order.receiptNumber}-REV`;
        const orderNumber = await generateOrderNumber(tx);
        
        console.log(`[CreateExchangeBatch] Creating shadow order ${revReceipt} (${orderNumber}) for client ${order.clientName}`);

        // Transfer the paid amount as a credit payment
        await tx.order.create({
          data: {
            receiptNumber: revReceipt,
            orderNumber: orderNumber,
            type: 'CAMBIO',
            status: 'POR_ENVIAR',
            clientId: order.clientId,
            clientName: order.clientName,
            brandId: order.brandId,
            total: order.total, // Initially the same, can be updated at reception
            salesChannel: order.salesChannel,
            paymentMethod: 'CAMBIO',
            bankAccountId: order.bankAccountId || defaultAccount.id,
            transactionDate: new Date(),
            possibleDeliveryDate: new Date(),
            parentOrderId: order.id,
            notes: `Reposición por cambio - Guía: ${dto.trackingGuide || 'S/N'}. Ref: ${order.receiptNumber}`,
            createdByName: dto.createdByName || 'system',
            items: {
              create: {
                productName: `REPOSICIÓN CAMBIO: ${order.receiptNumber}`,
                quantity: 1,
                unitPrice: order.total,
                brandId: order.brandId,
                brandName: (order as any).brand?.name || 'Marca'
              }
            },
            payments: {
              create: {
                amount: paid,
                method: 'EXCHANGE_CREDIT',
                description: `Abono transferido por cambio de pedido ${order.receiptNumber}`,
                createdAt: new Date()
              }
            }
          }
        });

        // Task: Add FinancialRecord for the exchange transfer to maintain audit trail
        if (paid > 0) {
          const client = await tx.client.findUnique({ where: { id: order.clientId }, select: { identificationNumber: true } });
          await tx.financialRecord.create({
            data: {
              type: 'EXCHANGE_CREDIT',
              referenceNumber: `EXC-TRANS-${order.id.substring(0, 8)}-${Date.now()}`,
              amount: paid,
              date: new Date(),
              clientId: order.clientId,
              clientName: order.clientName,
              clientDocument: client?.identificationNumber || '—',
              orderId: order.id,
              bankAccountId: order.bankAccountId || defaultAccount.id,
              source: 'EXCHANGE',
              paymentMethod: 'SALDO_A_FAVOR',
              movementType: 'INTERNAL',
              createdBy: dto.createdByName || 'system',
              notes: `Transferencia de abono por cambio | Cédula: ${client?.identificationNumber || '—'} | Orden: ${order.receiptNumber} | Pedido: ${order.orderNumber || '—'} | Marca: ${order.brand?.name || '—'} | Tipo: CAMBIO_REPOSICION`,
              version: 1,
              createdAt: new Date()
            }
          });
        }
      }

      return batch;
    });
  }
}
