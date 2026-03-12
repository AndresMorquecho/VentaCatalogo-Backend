import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class GetInventoryMovementsUseCase {
    async execute(filters: { 
        type?: string; 
        brandId?: string; 
        orderId?: string; 
        startDate?: string;
        endDate?: string;
        receiptNumber?: string;
        orderNumber?: string;
        search?: string;
        page?: number; 
        limit?: number 
    }): Promise<Result<{ data: any[]; total: number }>> {
        try {
            const page = filters.page;
            const limit = filters.limit;
            const startDate = filters.startDate?.trim() || undefined;
            const endDate = filters.endDate?.trim() || undefined;
            const receiptNumber = filters.receiptNumber?.trim() || undefined;
            const orderNumber = filters.orderNumber?.trim() || undefined;
            const search = filters.search?.trim() || undefined;
            const type = filters.type?.trim() || undefined;
            const brandId = filters.brandId?.trim() || undefined;
            const skip = page && limit ? (page - 1) * limit : undefined;
            const take = limit || undefined;

            const where: any = {};

            if (type && type !== 'ALL') where.type = type;
            if (brandId && brandId !== '') {
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brandId);
                if (isUuid) {
                    where.brandId = brandId;
                } else {
                    where.brand = { name: { contains: brandId, mode: 'insensitive' } };
                }
            }
            if (filters.orderId) where.orderId = filters.orderId;

            // Date Range
            if (startDate || endDate) {
                where.createdAt = {};
                if (startDate) where.createdAt.gte = new Date(startDate);
                if (endDate) {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    where.createdAt.lte = end;
                }
            }

            // Order-specific filters
            if (receiptNumber || orderNumber || search) {
                where.order = {};
                if (receiptNumber) where.order.receiptNumber = { contains: receiptNumber, mode: 'insensitive' };
                if (orderNumber) where.order.orderNumber = { contains: orderNumber, mode: 'insensitive' };
            }

            // Global search (Client name or ID, or Order details)
            if (search) {
                where.OR = [
                    { client: { firstName: { contains: search, mode: 'insensitive' } } },
                    { client: { identificationNumber: { contains: search, mode: 'insensitive' } } },
                    { order: { receiptNumber: { contains: search, mode: 'insensitive' } } },
                    { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
                    { order: { packingNumber: { contains: search, mode: 'insensitive' } } }
                ];
            }

            const [movements, total] = await Promise.all([
                prisma.inventoryMovement.findMany({
                    where,
                    include: {
                        order: {
                            include: {
                                payments: true,
                                brand: true
                            }
                        },
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
