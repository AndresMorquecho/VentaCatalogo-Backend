import { prisma } from '../../../lib/prisma';
import { Prisma } from '@prisma/client';

export interface UpdateExchangeItemDTO {
  exchangeId: string;
  itemId: string;
  newValue: number;
}

export class UpdateExchangeItemUseCase {
  async execute(dto: UpdateExchangeItemDTO) {
    const { exchangeId, itemId, newValue } = dto;

    const exchange = await prisma.orderExchange.findUnique({ where: { id: exchangeId } });
    if (!exchange) {
      throw new Error('Cambio no encontrado');
    }
    if (exchange.status === 'SENT_TO_SUPPLIER') {
      throw new Error('No se pueden modificar ítems cuando el cambio está enviado al proveedor');
    }

    const item = await prisma.orderExchangeItem.findFirst({
      where: { id: itemId, exchangeId },
    });
    if (!item) {
      throw new Error('Ítem no encontrado');
    }

    const differenceValue = new Prisma.Decimal(newValue).minus(item.originalValue);

    return await prisma.orderExchangeItem.update({
      where: { id: itemId },
      data: {
        newValue: new Prisma.Decimal(newValue),
        differenceValue,
      },
    });
  }
}
