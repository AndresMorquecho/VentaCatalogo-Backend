import { prisma } from '../../../lib/prisma';
import { generateNextExchangeNumber } from '../domain/exchangeNumber';

export interface CreateExchangeDTO {
  clientId: string;
  clientName: string;
  notes?: string;
  createdByName?: string;
}

export class CreateExchangeUseCase {
  async execute(dto: CreateExchangeDTO) {
    const { clientId, clientName, notes, createdByName } = dto;

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new Error('Cliente no encontrado');
    }

    return await prisma.$transaction(async (tx) => {
      const year = new Date().getFullYear();
      const exchangeNumber = await generateNextExchangeNumber(tx, year);

      const exchange = await tx.orderExchange.create({
        data: {
          exchangeNumber,
          clientId,
          clientName,
          status: 'RECEIVED_FROM_CLIENT',
          notes: notes ?? null,
          createdByName: createdByName ?? null,
        },
        include: { items: true },
      });

      return exchange;
    });
  }
}
