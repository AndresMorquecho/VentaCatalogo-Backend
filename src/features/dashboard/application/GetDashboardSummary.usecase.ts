import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class GetDashboardSummaryUseCase {
    async execute() {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const fifteenDaysAgo = new Date(today);
            fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            // ── ALL AGGREGATES IN PARALLEL ────────────────────────────────────────
            const [
                dailyIncomeAgg,
                monthlyIncomeAgg,
                currentCashAgg,
                ordersByStatusRaw,
                totalActiveClients,
                ordersReceivedToday,
                ordersDeliveredToday,
                pendingOrders,
                oldestOrdersRaw,
                ordersOver15Days,
                ordersOver30Days,
                salesTrend7days
            ] = await Promise.all([
                // Daily income
                prisma.financialRecord.aggregate({
                    where: { movementType: 'INCOME', date: { gte: today, lt: tomorrow } },
                    _sum: { amount: true }
                }),
                // Monthly income
                prisma.financialRecord.aggregate({
                    where: { movementType: 'INCOME', date: { gte: startOfMonth } },
                    _sum: { amount: true }
                }),
                // Current cash (sum of all active bank accounts)
                prisma.bankAccount.aggregate({
                    where: { isActive: true },
                    _sum: { currentBalance: true }
                }),
                // Orders by status
                prisma.order.groupBy({
                    by: ['status'],
                    _count: true
                }),
                // Active clients count
                prisma.client.count({ where: { isActive: true } }),
                // Orders received today
                prisma.order.count({
                    where: { status: { notIn: ['CANCELADO'] }, receptionDate: { gte: today, lt: tomorrow } }
                }),
                // Orders delivered today
                prisma.order.count({
                    where: { status: 'ENTREGADO', deliveryDate: { gte: today, lt: tomorrow } }
                }),
                // Pending orders for portfolio calculation
                prisma.order.findMany({
                    where: { status: { notIn: ['ENTREGADO', 'CANCELADO'] } },
                    select: {
                        total: true,
                        realInvoiceTotal: true,
                        payments: { select: { amount: true } }
                    }
                }),
                // Oldest orders in warehouse
                prisma.order.findMany({
                    where: { status: 'RECIBIDO_EN_BODEGA', receptionDate: { lte: fifteenDaysAgo } },
                    orderBy: { receptionDate: 'asc' },
                    take: 5,
                    select: {
                        receiptNumber: true,
                        clientName: true,
                        receptionDate: true,
                        total: true,
                        realInvoiceTotal: true
                    }
                }),
                // Orders over 15 days in warehouse
                prisma.order.count({
                    where: { status: 'RECIBIDO_EN_BODEGA', receptionDate: { lte: fifteenDaysAgo } }
                }),
                // Orders over 30 days in warehouse
                prisma.order.count({
                    where: { status: 'RECIBIDO_EN_BODEGA', receptionDate: { lte: thirtyDaysAgo } }
                }),
                // Financial records for last 7 days chart
                prisma.financialRecord.findMany({
                    where: { movementType: 'INCOME', date: { gte: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000) } },
                    select: { date: true, amount: true }
                })
            ]);

            // ── STATUS MAP ──────────────────────────────────────────────────────
            const statusCounts = ordersByStatusRaw.reduce((acc, item) => {
                acc[item.status] = item._count;
                return acc;
            }, {} as Record<string, number>);

            // ── PORTFOLIO PENDING ───────────────────────────────────────────────
            const totalPortfolioPending = pendingOrders.reduce((sum, order) => {
                const total = order.realInvoiceTotal ? Number(order.realInvoiceTotal) : Number(order.total);
                const paid = order.payments.reduce((pSum, p) => pSum + Number(p.amount), 0);
                return sum + Math.max(0, total - paid);
            }, 0);

            // ── OLDEST ORDERS ───────────────────────────────────────────────────
            const oldestOrders = oldestOrdersRaw.map(o => {
                const days = Math.floor((today.getTime() - new Date(o.receptionDate!).getTime()) / (1000 * 60 * 60 * 24));
                return {
                    id: o.receiptNumber,
                    clientName: o.clientName,
                    days,
                    value: o.realInvoiceTotal ? Number(o.realInvoiceTotal) : Number(o.total)
                };
            });

            const totalRetainedValue = oldestOrders.reduce((sum, o) => sum + o.value, 0);

            // ── SALES TREND (last 7 days) ───────────────────────────────────────
            const salesTrendMap: Record<string, number> = {};
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const key = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                salesTrendMap[key] = 0;
            }
            salesTrend7days.forEach(fr => {
                const d = new Date(fr.date);
                const key = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                if (salesTrendMap[key] !== undefined) {
                    salesTrendMap[key] += Number(fr.amount);
                }
            });
            const salesTrend = Object.entries(salesTrendMap).map(([date, amount]) => ({ date, amount }));

            // ── ORDERS TREND (last 7 days) — TASK-5.1: 2 batch queries instead of 14 sequential ──
            const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
            sevenDaysAgo.setHours(0, 0, 0, 0);

            const [createdByDay, deliveredByDay] = await Promise.all([
                prisma.order.findMany({
                    where: { createdAt: { gte: sevenDaysAgo } },
                    select: { createdAt: true }
                }),
                prisma.order.findMany({
                    where: { deliveryDate: { gte: sevenDaysAgo }, status: 'ENTREGADO' },
                    select: { deliveryDate: true }
                })
            ]);

            // Build 7-day trend map
            const ordersTrendDaily = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                d.setHours(0, 0, 0, 0);
                const dNext = new Date(d);
                dNext.setDate(dNext.getDate() + 1);
                const period = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                const created = createdByDay.filter(o => new Date(o.createdAt) >= d && new Date(o.createdAt) < dNext).length;
                const delivered = deliveredByDay.filter(o => o.deliveryDate && new Date(o.deliveryDate) >= d && new Date(o.deliveryDate) < dNext).length;
                ordersTrendDaily.push({ period, created, delivered });
            }

            // ── ORDER STATUS for pie chart ─────────────────────────────────────
            const orderStatus = [
                { status: 'Por Recibir', count: statusCounts['POR_RECIBIR'] || 0, color: '#F59E0B' },
                { status: 'En Bodega', count: statusCounts['RECIBIDO_EN_BODEGA'] || 0, color: '#3B82F6' },
                { status: 'Entregado', count: statusCounts['ENTREGADO'] || 0, color: '#10B981' },
                { status: 'Cancelado', count: statusCounts['CANCELADO'] || 0, color: '#EF4444' }
            ];

            return Result.ok({
                financial: {
                    dailyIncome: Number(dailyIncomeAgg._sum.amount || 0),
                    monthlyIncome: Number(monthlyIncomeAgg._sum.amount || 0),
                    dailyAbonos: Number(dailyIncomeAgg._sum.amount || 0), // Same as daily income for now
                    totalPortfolioPending,
                    overduePortfolioPercentage: 0,
                    currentCash: Number(currentCashAgg._sum.currentBalance || 0)
                },
                operational: {
                    ordersReceivedToday,
                    ordersPending: statusCounts['POR_RECIBIR'] || 0,
                    ordersInWarehouse: statusCounts['RECIBIDO_EN_BODEGA'] || 0,
                    ordersDeliveredToday,
                    totalOrdersDelivered: statusCounts['ENTREGADO'] || 0,
                    totalActiveClients,
                    ordersByStatus: {
                        porRecibir: statusCounts['POR_RECIBIR'] || 0,
                        recepcionado: statusCounts['RECIBIDO_EN_BODEGA'] || 0,
                        entregado: statusCounts['ENTREGADO'] || 0,
                        cancelado: statusCounts['CANCELADO'] || 0
                    },
                    averageWarehouseTimeDays: 0
                },
                tracking: {
                    ordersWithoutCall7Days: 0,
                    callsMadeToday: 0,
                    clientsWithoutRecentFollowup: 0
                },
                loyalty: {
                    pointsGeneratedThisMonth: 0,
                    topClients: [],
                    redemptionsMade: 0
                },
                alerts: {
                    ordersOver15Days,
                    ordersOver30Days,
                    totalRetainedValue,
                    oldestOrders
                },
                charts: {
                    salesTrend,
                    orderStatus,
                    warehouseTimeTrend: [{ month: 'Actual', days: 0 }],
                    comparison: {
                        category: 'Finanzas',
                        value1: Number(monthlyIncomeAgg._sum.amount || 0),
                        value2: totalPortfolioPending
                    },
                    ordersTrend: {
                        daily: ordersTrendDaily,
                        weekly: [],
                        monthly: []
                    }
                }
            });

        } catch (error) {
            console.error('GetDashboardSummaryUseCase ERROR:', error);
            return Result.fail('Error al generar resumen de dashboard');
        }
    }
}
