import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class GetInventoryMovementsUseCase {
    async execute(filters: { type?: string; brandId?: string; orderId?: string; page?: number; limit?: number }): Promise<Result<{ data: any[]; total: number }>> {
        try {
            const { page, limit } = filters;
            const skip = page && limit ? (page - 1) * limit : undefined;
            const take = limit || undefined;

            const where = {
                type: filters.type,
                brandId: filters.brandId,
                orderId: filters.orderId
            };

            const [movements, total] = await Promise.all([
                prisma.inventoryMovement.findMany({
                    where,
                    include: {
                        order: true,
                        client: true,
                        brand: true
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take
                }),
                prisma.inventoryMovement.count({ where })
            ]);

            return Result.ok({ data: movements, total });
        } catch (error) {
            console.error('GetInventoryMovementsUseCase Error:', error);
            return Result.fail('Error al obtener movimientos de inventario');
        }
    }
}
