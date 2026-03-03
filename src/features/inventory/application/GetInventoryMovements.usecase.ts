import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class GetInventoryMovementsUseCase {
    async execute(filters: { type?: string; brandId?: string; orderId?: string }) {
        try {
            const movements = await prisma.inventoryMovement.findMany({
                where: {
                    type: filters.type,
                    brandId: filters.brandId,
                    orderId: filters.orderId
                },
                include: {
                    order: true,
                    client: true,
                    brand: true
                },
                orderBy: { createdAt: 'desc' }
            });

            return Result.ok(movements);
        } catch (error) {
            console.error('GetInventoryMovementsUseCase Error:', error);
            return Result.fail('Error al obtener movimientos de inventario');
        }
    }
}
