import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

export class CreateExchangeBatchUseCase {
  async execute(dto: CreateExchangeBatchDTO) {
    if (!dto.items || dto.items.length === 0) {
      throw new Error('El lote debe tener al menos un pedido');
    }

    const orderIds = dto.items.map((i) => i.orderId);
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: { payments: true },
    });

    if (orders.length !== orderIds.length) {
      throw new Error('Uno o más pedidos no fueron encontrados');
    }

    for (const order of orders) {
      if (order.status !== 'ENTREGADO') {
        throw new Error(`El pedido ${order.receiptNumber} no está en estado ENTREGADO`);
      }
    }

    const batchNumber = generateBatchNumber();

    const batch = await prisma.exchangeBatch.create({
      data: {
        batchNumber,
        trackingGuide: dto.trackingGuide || null,
        notes: dto.notes || null,
        createdByName: dto.createdByName || null,
        status: 'SENT',
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
              invoiceTotal: order.realInvoiceTotal ?? null,
              paidAmount: paid,
              pendingAmount: pending,
              notes: itemInput?.notes || null,
            };
          }),
        },
      },
      include: { items: true },
    });

    return batch;
  }
}
