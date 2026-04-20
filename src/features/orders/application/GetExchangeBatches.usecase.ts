import { prisma } from '../../../lib/prisma';


export interface GetExchangeBatchesFilters {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export class GetExchangeBatchesUseCase {
  async execute(filters?: GetExchangeBatchesFilters) {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.dateFrom || filters?.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }

    return prisma.exchangeBatch.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
