import { prisma } from '../../../lib/prisma';
import { ValidationService } from './ValidationService';

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

function generateBatchNumber(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `LOTE-${yy}${mm}${dd}-${rand}`;
}

function calcPaid(payments: { method: string; amount: any }[]): number {
  const hasSplit = payments.some((p) => p.method === 'SPLIT_PAYMENT');
  return payments
    .filter((p) => !(hasSplit && p.method === 'CREDITO_CLIENTE'))
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

    const batchNumber = generateBatchNumber();
    console.log(`[CreateExchangeBatch] Creating batch ${batchNumber} with ${orders.length} orders`);

    return await prisma.$transaction(async (tx) => {
      // Task 4.2: Create batch with status ENVIADO and sentAt timestamp
      const batch = await tx.exchangeBatch.create({
        data: {
          batchNumber,
          trackingGuide: dto.trackingGuide || null,
          notes: dto.notes || null,
          createdByName: dto.createdByName || null,
          status: 'ENVIADO',
          sentAt: new Date(),
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

        await tx.order.create({
          data: {
            receiptNumber: revReceipt,
            orderNumber: orderNumber,
            type: 'CAMBIO',
            status: 'POR_RECIBIR',
            clientId: order.clientId,
            clientName: order.clientName,
            brandId: order.brandId,
            total: order.total, // Initially the same, can be updated at reception
            salesChannel: order.salesChannel,
            paymentMethod: 'CAMBIO',
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
            // Transfer the paid amount as a credit payment
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
      }

      return batch;
    });
  }
}
