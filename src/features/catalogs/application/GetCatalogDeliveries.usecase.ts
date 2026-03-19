import { Result } from '../../../shared/domain/Result';
import { CatalogDelivery } from '../domain/CatalogDelivery.entity';
import { ICatalogDeliveryRepository } from '../domain/ICatalogDeliveryRepository';
import { prisma } from '../../../lib/prisma';

export interface GetCatalogDeliveriesFilters {
  clientId?: string;
  brandId?: string;
  campaign?: string;
  type?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface EnrichedDelivery extends CatalogDelivery {
  madeOrder: boolean;
  lastOrderDate: Date | null;
}

export class GetCatalogDeliveriesUseCase {
  constructor(private deliveryRepository: ICatalogDeliveryRepository) {}

  async execute(filters: GetCatalogDeliveriesFilters): Promise<Result<{ data: any[]; total: number; page: number; limit: number }>> {
    try {
      const result = await this.deliveryRepository.findMany(filters);

      // Enriquecer con información de pedidos de la marca (sin importar campaña)
      const enriched = await Promise.all(
        result.data.map(async (delivery) => {
          const lastOrder = await prisma.order.findFirst({
            where: {
              clientId: delivery.clientId,
              brandId: delivery.brandId
            },
            orderBy: { transactionDate: 'desc' },
            select: { transactionDate: true }
          });

          return {
            ...delivery.toJSON(),
            madeOrder: lastOrder !== null,
            lastOrderDate: lastOrder?.transactionDate || null
          };
        })
      );

      return Result.ok({
        data: enriched,
        total: result.total,
        page: filters.page || 1,
        limit: filters.limit || 20
      });
    } catch (error) {
      console.error('GetCatalogDeliveriesUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al obtener entregas');
    }
  }
}
