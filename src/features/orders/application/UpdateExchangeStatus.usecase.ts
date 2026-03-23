import { prisma } from '../../../lib/prisma';

export interface UpdateExchangeStatusDTO {
  exchangeId: string;
  newStatus: 'SENT_TO_SUPPLIER' | 'RECEIVED_FROM_SUPPLIER';
}

const VALID_TRANSITIONS: Record<string, string> = {
  RECEIVED_FROM_CLIENT: 'SENT_TO_SUPPLIER',
  SENT_TO_SUPPLIER: 'RECEIVED_FROM_SUPPLIER',
};

export class UpdateExchangeStatusUseCase {
  async execute(dto: UpdateExchangeStatusDTO) {
    const { exchangeId, newStatus } = dto;

    const exchange = await prisma.orderExchange.findUnique({ 
      where: { id: exchangeId },
      include: { items: true }
    });
    if (!exchange) {
      throw new Error('Cambio no encontrado');
    }

    if (VALID_TRANSITIONS[exchange.status] !== newStatus) {
      throw new Error('Transición de estado no válida');
    }

    const updateData: Record<string, any> = { status: newStatus };
    
    return await prisma.$transaction(async (tx) => {
      if (newStatus === 'SENT_TO_SUPPLIER') {
        updateData.sentAt = new Date();
        
        // Create a shadow Order for each item in the exchange
        // This makes them appear in the reception list
        for (const item of exchange.items) {
          const originalOrder = await tx.order.findUnique({ 
            where: { id: item.originalOrderId },
            include: { brand: true }
          });
          
          if (!originalOrder) continue;

          // Create the new "Exchange" Order
          const newValue = item.newValue ? Number(item.newValue) : Number(item.originalValue);
          const originalValue = Number(item.originalValue);

          const newOrder = await tx.order.create({
            data: {
              receiptNumber: `${originalOrder.receiptNumber}-EX-${item.id.substring(0, 4)}`,
              type: 'CAMBIO',
              status: 'POR_RECIBIR',
              clientId: exchange.clientId,
              clientName: exchange.clientName,
              brandId: originalOrder.brandId,
              total: newValue,
              salesChannel: originalOrder.salesChannel,
              paymentMethod: 'CAMBIO',
              transactionDate: new Date(),
              possibleDeliveryDate: new Date(),
              parentOrderId: originalOrder.id,
              exchangeItemId: item.id,
              notes: `Cambio de item: ${item.productName}. Original: ${originalOrder.receiptNumber}`,
              createdByName: exchange.createdByName || 'system',
              items: {
                create: {
                  productName: `CAMBIO: ${item.productName}`,
                  quantity: 1,
                  unitPrice: newValue,
                  brandId: originalOrder.brandId,
                  brandName: (originalOrder as any).brand?.name || 'Marca'
                }
              },
              payments: {
                create: {
                  amount: originalValue,
                  method: 'EXCHANGE_CREDIT',
                  description: `Saldo a favor transferido desde pedido original ${originalOrder.receiptNumber}`
                }
              }
            } as any
          });

          // Update the exchange item with its link to the new order
          await tx.orderExchangeItem.update({
            where: { id: item.id },
            data: { status: 'SENT_TO_SUPPLIER' }
          });
        }
      } else if (newStatus === 'RECEIVED_FROM_SUPPLIER') {
        updateData.receivedAt = new Date();
      }

      return await tx.orderExchange.update({
        where: { id: exchangeId },
        data: updateData,
        include: { items: true },
      });
    });
  }
}
