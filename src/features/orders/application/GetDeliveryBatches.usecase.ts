import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export interface DeliveryBatchFilters {
  searchText?: string;
  startDate?: string;
  endDate?: string;
  clientId?: string;
  orderQuantity?: string;
  type?: string;
  page?: number;
  limit?: number;
}

export class GetDeliveryBatchesUseCase {
  async execute(filters: DeliveryBatchFilters): Promise<Result<any>> {
    const { searchText, startDate, endDate, page, limit, type } = filters;
    const skip = (page && limit) ? (page - 1) * limit : undefined;

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

      if (filters.clientId) {
        where.orders = { some: { clientId: filters.clientId } };
      }

      if (type && type !== 'all') {
        where.orders = { 
          some: { 
            ...(where.orders?.some || {}),
            type 
          } 
        };
      }

      if (filters.orderQuantity) {
          const qty = parseInt(filters.orderQuantity);
          if (!isNaN(qty)) {
              // Find IDs of batches that have exactly this many orders
              const batchesWithQty = await prisma.$queryRaw<Array<{ delivery_batch_id: string }>>`
                SELECT delivery_batch_id
                FROM orders
                WHERE delivery_batch_id IS NOT NULL
                GROUP BY delivery_batch_id
                HAVING COUNT(*) = ${qty}
              `;
              const allowedIds = batchesWithQty.map(b => b.delivery_batch_id);
              if (allowedIds.length === 0) return Result.ok({ data: [], pagination: { total: 0, page: page || 1, limit: limit || 0, pages: 0 } });
              where.id = { in: allowedIds };
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
                client: true,
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
          page: page || 1,
          limit: limit || total,
          pages: limit ? Math.ceil(total / (limit || 1)) : 1
        }
      });
    } catch (error) {
      console.error('[GetDeliveryBatchesUseCase] Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al obtener historial de entregas');
    }
  }
}
