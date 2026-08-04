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
        orderType?: string;
        page?: number; 
        limit?: number 
    }): Promise<Result<{ data: any[]; total: number; stats: any }>> {
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
            const orderType = filters.orderType?.trim() || undefined;
            const skip = page && limit ? (page - 1) * limit : undefined;
            const take = limit || undefined;

            // ⏱️ We query the Order table as PRIMARY source to ensure all orders appear
            const orderWhere: any = {
                type: { not: 'CATALOGO' }
            };

            // 0. Order Type Filter
            if (orderType && orderType !== 'all') {
                orderWhere.type = orderType;
            }

            // 1. Status Filter (mapped from 'type' which is a logistics action)
            if (typeValue && typeValue !== 'ALL') {
                if (typeValue === 'ENTRY') {
                    orderWhere.status = 'RECIBIDO_EN_BODEGA';
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

            // 4. Date Range Filter (applied to order creation date)
            if (startDate || endDate) {
                orderWhere.createdAt = {};
                if (startDate) orderWhere.createdAt.gte = new Date(startDate + 'T00:00:00.000Z');
                if (endDate) orderWhere.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
            }

            // 5. Global Search
            if (search) {
                orderWhere.OR = [
                    { receiptNumber: { contains: search, mode: 'insensitive' } },
                    { orderNumber: { contains: search, mode: 'insensitive' } },
                    { clientName: { contains: search, mode: 'insensitive' } },
                    { packingNumber: { contains: search, mode: 'insensitive' } },
                    { client: { identificationNumber: { contains: search, mode: 'insensitive' } } }
                ];
            }

            // 📊 Calculate start and end of TODAY in local Ecuador Timezone (UTC-5)
            const ecuadorDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
            const todayStart = new Date(`${ecuadorDateStr}T00:00:00.000-05:00`);
            const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
            const fifteenDaysAgo = new Date();
            fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

            // Clean filter for global KPI summary cards (respects brand/orderType if set, but NOT table search/status/date filters)
            const statsWhere: any = {
                type: { not: 'CATALOGO' }
            };
            if (orderType && orderType !== 'all') {
                statsWhere.type = orderType;
            }
            if (brandId && brandId !== '') {
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brandId);
                if (isUuid) {
                    statsWhere.brandId = brandId;
                } else {
                    statsWhere.brand = { name: { contains: brandId, mode: 'insensitive' } };
                }
            }

            const [orders, totalCount, stats] = await Promise.all([
                prisma.order.findMany({
                    where: orderWhere,
                    include: {
                        client: true,
                        brand: true,
                        payments: true,
                        items: true,
                        inventoryMovements: {
                          orderBy: { createdAt: 'asc' }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take
                }),
                prisma.order.count({ where: orderWhere }),
                Promise.all([
                    prisma.order.count({ where: { ...statsWhere, status: 'POR_RECIBIR' } }),
                    prisma.order.count({ where: { ...statsWhere, status: 'RECIBIDO_EN_BODEGA' } }),
                    prisma.order.count({
                        where: {
                            ...statsWhere,
                            status: 'ENTREGADO',
                            deliveryDate: { gte: todayStart, lt: tomorrowStart }
                        }
                    }),
                    prisma.order.count({
                        where: {
                            ...statsWhere,
                            status: 'RECIBIDO_EN_BODEGA',
                            receptionDate: { lte: fifteenDaysAgo }
                        }
                    })
                ]).then(([pending, inWarehouse, deliveredToday, longStorage]) => ({
                    pending,
                    inWarehouse,
                    deliveredToday,
                    longStorage
                }))
            ]);

            const finalMovements: any[] = [];
            
            for (const order of orders) {
                const moves = order.inventoryMovements || [];
                const totalQuantity = (order.items || []).reduce((sum: number, it: any) => sum + (it.quantity || 0), 0);
                const orderBase = { ...order, inventoryMovements: undefined, items: undefined };

                if (moves.length > 0) {
                    const relevantMoves = (typeValue && typeValue !== 'ALL')
                        ? moves.filter((m: any) => m.type === typeValue)
                        : moves;

                    if (relevantMoves.length > 0) {
                        // Order has matching movement records — use them
                        relevantMoves.forEach((m: any) => {
                            finalMovements.push({
                                ...m,
                                totalQuantity,
                                order: orderBase,
                                client: order.client,
                                brand: order.brand
                            });
                        });
                    } else {
                        // Order has movements but none match the requested type.
                        // Create a synthetic entry based on order status so the order still appears.
                        const mapStatusToType = (status: string) => {
                            if (status === 'ENTREGADO') return 'DELIVERED';
                            if (status === 'RECIBIDO_EN_BODEGA') return 'ENTRY';
                            if (status === 'DEVUELTO') return 'RETURNED';
                            return status;
                        };

                        finalMovements.push({
                            id: `synth-${order.id}`,
                            orderId: order.id,
                            clientId: order.clientId,
                            brandId: order.brandId,
                            type: typeValue || mapStatusToType(order.status),
                            createdAt: order.receptionDate || order.createdAt,
                            createdBy: order.receivedByName || order.createdByName || 'S/N',
                            totalQuantity,
                            order: orderBase,
                            client: order.client,
                            brand: order.brand
                        });
                    }
                } else {
                    // Order has NO inventory movement records at all.
                    const mapStatusToType = (status: string) => {
                        if (status === 'ENTREGADO') return 'DELIVERED';
                        if (status === 'RECIBIDO_EN_BODEGA') return 'ENTRY';
                        if (status === 'DEVUELTO') return 'RETURNED';
                        return status;
                    };

                    if (typeValue && typeValue !== 'ALL') {
                        // Still include as a synthetic entry — order status already matched the filter.
                        finalMovements.push({
                            id: `synth-${order.id}`,
                            orderId: order.id,
                            clientId: order.clientId,
                            brandId: order.brandId,
                            type: typeValue === 'ALL' ? mapStatusToType(order.status) : typeValue,
                            createdAt: order.receptionDate || order.createdAt,
                            createdBy: order.receivedByName || order.createdByName || 'S/N',
                            totalQuantity,
                            order: orderBase,
                            client: order.client,
                            brand: order.brand
                        });
                    } else {
                        // No type filter — show as virtual entry based on current status
                        const type = mapStatusToType(order.status);
                        finalMovements.push({
                            id: `pend-${order.id}`,
                            orderId: order.id,
                            clientId: order.clientId,
                            brandId: order.brandId,
                            type: type === 'POR_RECIBIR' ? 'POR_RECIBIR' : type, 
                            createdAt: order.receptionDate || order.createdAt,
                            createdBy: order.receivedByName || order.createdByName || 'S/N',
                            totalQuantity,
                            order: orderBase,
                            client: order.client,
                            brand: order.brand
                        });
                    }
                }
            }

            return Result.ok({ 
                data: finalMovements, 
                total: totalCount,
                stats
            });
        } catch (error) {
            console.error('GetInventoryMovementsUseCase Error:', error);
            return Result.fail('Error al obtener movimientos de inventario');
        }
    }
}
