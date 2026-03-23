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

    const exchange = await prisma.orderExchange.findUnique({ where: { id: exchangeId } });
    if (!exchange) {
      throw new Error('Cambio no encontrado');
    }

    if (VALID_TRANSITIONS[exchange.status] !== newStatus) {
      throw new Error('Transición de estado no válida');
    }

    const updateData: Record<string, any> = { status: newStatus };
    if (newStatus === 'SENT_TO_SUPPLIER') {
      updateData.sentAt = new Date();
    } else if (newStatus === 'RECEIVED_FROM_SUPPLIER') {
      updateData.receivedAt = new Date();
    }

    return await prisma.orderExchange.update({
      where: { id: exchangeId },
      data: updateData,
      include: { items: true },
    });
  }
}
