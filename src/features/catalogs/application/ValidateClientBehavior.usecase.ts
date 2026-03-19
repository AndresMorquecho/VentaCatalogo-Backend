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
      // Buscar última entrega de catálogos de esa marca al cliente
      const lastDelivery = await this.deliveryRepository.findLastDeliveryByClientAndBrand(
        dto.clientId,
        dto.brandId
      );

      // Si no hay entregas previas, no hay advertencia
      if (!lastDelivery) {
        return Result.ok({ warning: false });
      }

      // Buscar pedidos del cliente de esa marca después de la última entrega
      const ordersAfterDelivery = await prisma.order.count({
        where: {
          clientId: dto.clientId,
          brandId: dto.brandId,
          transactionDate: { gte: lastDelivery.deliveredAt }
        }
      });

      // Si no hay pedidos después de la entrega, mostrar advertencia
      if (ordersAfterDelivery === 0) {
        return Result.ok({
          warning: true,
          message: 'Esta cliente recibió catálogos anteriormente pero no ha generado pedidos recientes',
          lastDeliveryDate: lastDelivery.deliveredAt
        });
      }

      return Result.ok({ warning: false });
    } catch (error) {
      console.error('ValidateClientBehaviorUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al validar comportamiento');
    }
  }
}
