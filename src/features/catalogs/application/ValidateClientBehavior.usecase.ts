import { Result } from '../../../shared/domain/Result';
import { ICatalogDeliveryRepository } from '../domain/ICatalogDeliveryRepository';
import { prisma } from '../../../lib/prisma';

export interface ValidateClientBehaviorDTO {
  clientId: string;
  brandId: string;
}

export interface BehaviorValidationResult {
  warning: boolean;
  message?: string;
  lastDeliveryDate?: Date;
}

export class ValidateClientBehaviorUseCase {
  constructor(private deliveryRepository: ICatalogDeliveryRepository) {}

  async execute(dto: ValidateClientBehaviorDTO): Promise<Result<BehaviorValidationResult>> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // 1. Verificar si tiene un pedido ENTREGADO reciente (últimos 30 días)
      // Si tiene uno, no mostramos advertencia independientemente de si recibió catálogos antes
      const recentOrder = await prisma.order.findFirst({
        where: {
          clientId: dto.clientId,
          brandId: dto.brandId,
          status: 'ENTREGADO',
          deliveryDate: { gte: thirtyDaysAgo }
        }
      });

      if (recentOrder) {
        return Result.ok({ warning: false });
      }

      // 2. Si no tiene pedido reciente, verificar si se le entregó catálogos anteriormente
      const lastDelivery = await this.deliveryRepository.findLastDeliveryByClientAndBrand(
        dto.clientId,
        dto.brandId
      );

      // Si no hay entregas previas, no hay advertencia (es su primer acercamiento o pasó mucho tiempo)
      if (!lastDelivery) {
        return Result.ok({ warning: false });
      }

      // Si llegamos aquí, es porque recibió catálogos pero no ha "entregado" ningún pedido en los últimos 30 días
      return Result.ok({
        warning: true,
        message: 'Esta cliente recibió catálogos anteriormente pero no tiene pedidos entregados en los últimos 30 días',
        lastDeliveryDate: lastDelivery.deliveredAt
      });
    } catch (error) {
      console.error('ValidateClientBehaviorUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al validar comportamiento');
    }
  }
}
