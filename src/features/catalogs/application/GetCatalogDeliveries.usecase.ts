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
      const result = await this.deliveryRepository.findMany({
        ...filters,
        limit: filters.limit || 15
      });

      // Enriquecer con información de pedidos de la marca (sin importar campaña)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const enriched = await Promise.all(
        result.data.map(async (delivery) => {
          // Buscamos el último pedido de esta marca hecho por la empresaria (sin importar fecha)
          const lastOrder = await prisma.order.findFirst({
            where: {
              clientId: delivery.clientId,
              brandId: delivery.brandId,
              type: { not: 'CATALOGO' },
              status: 'ENTREGADO'
            },
            orderBy: { deliveryDate: 'desc' },
            select: { deliveryDate: true }
          });

          const isRecent = lastOrder?.deliveryDate 
            ? lastOrder.deliveryDate >= thirtyDaysAgo 
            : false;

          return {
            ...delivery.toJSON(),
            madeOrder: isRecent,
            lastOrderDate: lastOrder?.deliveryDate || null
          };
        })
      );

      return Result.ok({
        data: enriched,
        total: result.total,
        page: filters.page || 1,
        limit: filters.limit || 15
      });
    } catch (error) {
      console.error('GetCatalogDeliveriesUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al obtener entregas');
    }
  }
}

// Helper to get start of day for comparison
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
