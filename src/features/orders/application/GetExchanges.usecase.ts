import { prisma } from '../../../lib/prisma';

export interface GetExchangesFilters {
  clientId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  onlyExchanges?: boolean;
}

export class GetExchangesUseCase {
  async execute(filters: GetExchangesFilters = {}) {
    const { clientId, status, dateFrom, dateTo, onlyExchanges } = filters;

    const where: Record<string, any> = {};

    if (clientId) where.clientId = clientId;

    if (onlyExchanges) {
      where.status = 'RECEIVED_FROM_SUPPLIER';
    } else if (status) {
      where.status = status;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    return await prisma.orderExchange.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
