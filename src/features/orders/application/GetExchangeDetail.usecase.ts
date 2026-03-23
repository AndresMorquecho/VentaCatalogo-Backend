import { prisma } from '../../../lib/prisma';

export class GetExchangeDetailUseCase {
  async execute(exchangeId: string) {
    const exchange = await prisma.orderExchange.findUnique({
      where: { id: exchangeId },
      include: {
        items: true,
        client: {
          select: {
            id: true,
            firstName: true,
            identificationNumber: true,
            phone1: true,
            city: true,
          },
        },
      },
    });

    if (!exchange) {
      throw new Error('Cambio no encontrado');
    }

    return exchange;
  }
}
