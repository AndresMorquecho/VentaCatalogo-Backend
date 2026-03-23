import { prisma } from '../../../lib/prisma';
import { Prisma } from '@prisma/client';

export interface AddExchangeItemDTO {
  exchangeId: string;
  originalOrderId: string;
  productName: string;
  originalValue: number;
  newValue?: number | null;
}

export class AddExchangeItemUseCase {
  async execute(dto: AddExchangeItemDTO) {
    const { exchangeId, originalOrderId, productName, originalValue, newValue } = dto;

    const exchange = await prisma.orderExchange.findUnique({ where: { id: exchangeId } });
    if (!exchange) {
      throw new Error('Cambio no encontrado');
    }
    if (exchange.status !== 'RECEIVED_FROM_CLIENT') {
      throw new Error('Solo se pueden agregar ítems cuando el cambio está en estado RECEIVED_FROM_CLIENT');
    }

    const order = await prisma.order.findUnique({ where: { id: originalOrderId } });
    if (!order) {
      throw new Error('Pedido no encontrado');
    }
    if (order.status !== 'ENTREGADO') {
      throw new Error('Solo se pueden crear cambios para pedidos en estado ENTREGADO');
    }

    const existing = await prisma.orderExchangeItem.findFirst({
      where: { exchangeId, originalOrderId },
    });
    if (existing) {
      throw new Error('El pedido ya está incluido en este cambio');
    }

    const differenceValue =
      newValue != null ? new Prisma.Decimal(newValue).minus(new Prisma.Decimal(originalValue)) : null;

    const item = await prisma.orderExchangeItem.create({
      data: {
        exchangeId,
        originalOrderId,
        productName,
        originalValue: new Prisma.Decimal(originalValue),
        newValue: newValue != null ? new Prisma.Decimal(newValue) : null,
        differenceValue,
        status: 'PENDING',
        financialProcessed: false,
      },
    });

    return item;
  }
}
