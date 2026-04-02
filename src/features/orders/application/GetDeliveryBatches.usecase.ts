import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export interface DeliveryBatchFilters {
  searchText?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export class GetDeliveryBatchesUseCase {
  async execute(filters: DeliveryBatchFilters): Promise<Result<any>> {
    const { searchText, startDate, endDate, page = 1, limit = 25 } = filters;
    const skip = (page - 1) * limit;

    try {
      const where: any = {};

      if (searchText) {
        where.OR = [
          { deliveryNumber: { contains: searchText, mode: 'insensitive' } },
          { deliveredByName: { contains: searchText, mode: 'insensitive' } },
          { orders: { some: { clientName: { contains: searchText, mode: 'insensitive' } } } },
          { orders: { some: { receiptNumber: { contains: searchText, mode: 'insensitive' } } } }
        ];
      }

      if (startDate || endDate) {
        where.deliveryDate = {};
        if (startDate) where.deliveryDate.gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          where.deliveryDate.lte = end;
        }
      }

      // @ts-ignore
      const [batches, total] = await Promise.all([
        // @ts-ignore
        prisma.deliveryBatch.findMany({
          where,
          include: {
            orders: {
              include: {
                payments: true,
                brand: true,
              }
            },
            payments: {
              select: {
                id: true,
                amount: true,
                method: true,
                reference: true,
              }
            }
          },
          orderBy: { deliveryDate: 'desc' },
          skip,
          take: limit
        }),
        // @ts-ignore
        prisma.deliveryBatch.count({ where })
      ]);

      return Result.ok({
        data: batches,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('[GetDeliveryBatchesUseCase] Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al obtener historial de entregas');
    }
  }
}
