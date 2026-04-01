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
            const typeValue = filters.type?.trim() || undefined;
            const brandId = filters.brandId?.trim() || undefined;
            const skip = page && limit ? (page - 1) * limit : undefined;
            const take = limit || undefined;

            // ⏱️ We query the Order table as PRIMARY source to ensure PENDING orders appear
            const orderWhere: any = {
                type: { not: 'CATALOGO' }
            };

            // 1. Status Filter (mapped from 'type' which is a logistics action)
            if (typeValue && typeValue !== 'ALL') {
                if (typeValue === 'ENTRY') {
                    orderWhere.status = { in: ['RECIBIDO_EN_BODEGA', 'ENTREGADO'] };
                } else if (typeValue === 'DELIVERED') {
                    orderWhere.status = 'ENTREGADO';
                } else if (typeValue === 'RETURNED') {
                    orderWhere.inventoryMovements = { some: { type: 'RETURNED' } };
                }
            } else {
                orderWhere.status = { 
                    in: ['POR_RECIBIR', 'RECIBIDO_EN_BODEGA', 'ENTREGADO', 'ENVIADO_A_CAMBIO', 'DESMANTELADO', 'RECLAMO_A_BODEGA'] 
                };
            }

            // 2. Brand Filter
            if (brandId && brandId !== '') {
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brandId);
                if (isUuid) {
                    orderWhere.brandId = brandId;
                } else {
                    orderWhere.brand = { name: { contains: brandId, mode: 'insensitive' } };
                }
            }

            // 3. Receipt/Order filters
            if (receiptNumber) orderWhere.receiptNumber = { contains: receiptNumber, mode: 'insensitive' };
            if (orderNumber) orderWhere.orderNumber = { contains: orderNumber, mode: 'insensitive' };
            if (filters.orderId) orderWhere.id = filters.orderId;

            // 4. Global Search
            if (search) {
                orderWhere.OR = [
                    { receiptNumber: { contains: search, mode: 'insensitive' } },
                    { orderNumber: { contains: search, mode: 'insensitive' } },
                    { clientName: { contains: search, mode: 'insensitive' } },
                    { packingNumber: { contains: search, mode: 'insensitive' } },
                    { client: { identificationNumber: { contains: search, mode: 'insensitive' } } }
                ];
            }

            // 📊 Fetch paginated orders
            const [orders, totalCount] = await Promise.all([
                prisma.order.findMany({
                    where: orderWhere,
                    include: {
                        client: true,
                        brand: true,
                        payments: true,
                        inventoryMovements: {
                          orderBy: { createdAt: 'asc' }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take
                }),
                prisma.order.count({ where: orderWhere })
            ]);

            const finalMovements: any[] = [];
            
            for (const order of orders) {
                const moves = order.inventoryMovements || [];
                if (moves.length > 0) {
                    const relevantMoves = (typeValue && typeValue !== 'ALL')
                        ? moves.filter((m: any) => m.type === typeValue)
                        : moves;

                    relevantMoves.forEach((m: any) => {
                        finalMovements.push({
                            ...m,
                            order: { ...order, inventoryMovements: undefined },
                            client: order.client,
                            brand: order.brand
                        });
                    });
                } else {
                    if (typeValue && typeValue !== 'ALL') continue;

                    finalMovements.push({
                        id: `pend-${order.id}`,
                        orderId: order.id,
                        clientId: order.clientId,
                        brandId: order.brandId,
                        type: 'POR_RECIBIR', 
                        createdAt: order.createdAt,
                        createdBy: order.createdByName || 'S/N',
                        order: { ...order, inventoryMovements: undefined },
                        client: order.client,
                        brand: order.brand
                    });
                }
            }

            return Result.ok({ data: finalMovements, total: totalCount });
        } catch (error) {
            console.error('GetInventoryMovementsUseCase Error:', error);
            return Result.fail('Error al obtener movimientos de inventario');
        }
    }
}
