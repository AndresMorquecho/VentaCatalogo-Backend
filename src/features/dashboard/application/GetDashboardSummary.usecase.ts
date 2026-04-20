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
            const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
            sevenDaysAgo.setHours(0, 0, 0, 0);

            // ── TOTAL OPTIMIZATION: RAW SQL FOR EVERYTHING ──
            // Using a single large query to minimize database roundtrips and connection duration
            const [statsRaw, trendRaw, ordersTrendRaw] = await Promise.all([
                // 1. Basic Stats
                prisma.$queryRaw<any[]>`
                    SELECT 
                        (SELECT COALESCE(SUM(amount), 0) FROM financial_records WHERE movement_type = 'INCOME' AND date >= ${today} AND date < ${tomorrow}) as daily_income,
                        (SELECT COALESCE(SUM(amount), 0) FROM financial_records WHERE movement_type = 'INCOME' AND date >= ${startOfMonth}) as monthly_income,
                        (SELECT COALESCE(SUM(current_balance), 0) FROM bank_accounts WHERE is_active = true) as current_cash,
                        (SELECT count(id) FROM clients WHERE is_active = true) as active_clients,
                        (SELECT count(id) FROM orders WHERE status != 'CANCELADO' AND (reception_date >= ${today} AND reception_date < ${tomorrow})) as orders_received_today,
                        (SELECT count(id) FROM orders WHERE status = 'ENTREGADO' AND (delivery_date >= ${today} AND delivery_date < ${tomorrow})) as orders_delivered_today,
                        (SELECT count(id) FROM orders WHERE status = 'RECIBIDO_EN_BODEGA' AND reception_date <= ${fifteenDaysAgo}) as orders_over_15d,
                        (SELECT count(id) FROM orders WHERE status = 'RECIBIDO_EN_BODEGA' AND reception_date <= ${thirtyDaysAgo}) as orders_over_30d,
                        (SELECT count(id) FROM orders WHERE status = 'POR_RECIBIR') as status_por_recibir,
                        (SELECT count(id) FROM orders WHERE status = 'RECIBIDO_EN_BODEGA') as status_en_bodega,
                        (SELECT count(id) FROM orders WHERE status = 'ENTREGADO') as status_entregado,
                        (SELECT count(id) FROM orders WHERE status = 'CANCELADO') as status_cancelado,
                        (SELECT SUM(pending) FROM (
                            SELECT GREATEST(0, COALESCE(o.real_invoice_total, o.total) - COALESCE(p.paid, 0)) as pending
                            FROM orders o
                            LEFT JOIN (
                                SELECT order_id, SUM(amount) as paid 
                                FROM order_payments 
                                GROUP BY order_id
                            ) p ON o.id = p.order_id
                            WHERE o.status NOT IN ('ENTREGADO', 'CANCELADO')
                        ) as portfolio) as total_portfolio
                `,
                // 2. Sales Trend (Income sum per day)
                prisma.$queryRaw<any[]>`
                    SELECT DATE(date) as day, SUM(amount) as amount
                    FROM financial_records 
                    WHERE movement_type = 'INCOME' AND date >= ${sevenDaysAgo}
                    GROUP BY DATE(date)
                    ORDER BY day ASC
                `,
                // 3. Orders Trend (Count per day)
                prisma.$queryRaw<any[]>`
                    SELECT 
                        days.day,
                        COALESCE(c.created, 0) as created,
                        COALESCE(d.delivered, 0) as delivered
                    FROM (
                        SELECT generate_series(${sevenDaysAgo}::date, ${today}::date, '1 day'::interval)::date as day
                    ) days
                    LEFT JOIN (
                        SELECT DATE(created_at) as day, COUNT(*) as created FROM orders GROUP BY DATE(created_at)
                    ) c ON days.day = c.day
                    LEFT JOIN (
                        SELECT DATE(delivery_date) as day, COUNT(*) as delivered FROM orders WHERE status = 'ENTREGADO' GROUP BY DATE(delivery_date)
                    ) d ON days.day = d.day
                    ORDER BY days.day ASC
                `
            ]);

            const stats = statsRaw[0] || {};

            // ── COMPLEMENTARY QUERY: Oldest Orders (keep Prisma for easy pagination/mapping) ─
            const oldestOrdersRaw = await prisma.order.findMany({
                where: { status: 'RECIBIDO_EN_BODEGA', receptionDate: { lte: fifteenDaysAgo } },
                orderBy: { receptionDate: 'asc' },
                take: 5,
                select: {
                    id: true,
                    receiptNumber: true,
                    clientName: true,
                    receptionDate: true,
                    total: true,
                    realInvoiceTotal: true
                }
            });

            // ── TRANSFORM TREND DATA ──────────────────────────────────────────
            const salesTrend = trendRaw.map(t => ({
                date: `${new Date(t.day).getDate().toString().padStart(2, '0')}/${(new Date(t.day).getMonth() + 1).toString().padStart(2, '0')}`,
                amount: Number(t.amount)
            }));

            const ordersTrendDaily = ordersTrendRaw.map(t => ({
                period: `${new Date(t.day).getDate().toString().padStart(2, '0')}/${(new Date(t.day).getMonth() + 1).toString().padStart(2, '0')}`,
                created: Number(t.created),
                delivered: Number(t.delivered)
            }));

            // ── OLDEST ORDERS MAPPING ───────────────────────────────────────────
            const oldestOrders = oldestOrdersRaw.map(o => {
                const days = Math.floor((today.getTime() - new Date(o.receptionDate!).getTime()) / (1000 * 60 * 60 * 24));
                return {
                    id: o.id,
                    receiptNumber: o.receiptNumber,
                    clientName: o.clientName,
                    days,
                    value: o.realInvoiceTotal ? Number(o.realInvoiceTotal) : Number(o.total)
                };
            });

            const totalRetainedValue = oldestOrders.reduce((sum, o) => sum + o.value, 0);

            // ── ORDER STATUS for pie chart ─────────────────────────────────────
            const orderStatus = [
                { status: 'Por Recibir', count: Number(stats.status_por_recibir || 0), color: '#F59E0B' },
                { status: 'En Bodega', count: Number(stats.status_en_bodega || 0), color: '#3B82F6' },
                { status: 'Entregado', count: Number(stats.status_entregado || 0), color: '#10B981' },
                { status: 'Cancelado', count: Number(stats.status_cancelado || 0), color: '#EF4444' }
            ];

            return Result.ok({
                financial: {
                    dailyIncome: Number(stats.daily_income || 0),
                    monthlyIncome: Number(stats.monthly_income || 0),
                    dailyAbonos: Number(stats.daily_income || 0),
                    totalPortfolioPending: Number(stats.total_portfolio || 0),
                    overduePortfolioPercentage: 0,
                    currentCash: Number(stats.current_cash || 0)
                },
                operational: {
                    ordersReceivedToday: Number(stats.orders_received_today || 0),
                    ordersPending: Number(stats.status_por_recibir || 0),
                    ordersInWarehouse: Number(stats.status_en_bodega || 0),
                    ordersDeliveredToday: Number(stats.orders_delivered_today || 0),
                    totalOrdersDelivered: Number(stats.status_entregado || 0),
                    totalActiveClients: Number(stats.active_clients || 0),
                    ordersByStatus: {
                        porRecibir: Number(stats.status_por_recibir || 0),
                        recepcionado: Number(stats.status_en_bodega || 0),
                        entregado: Number(stats.status_entregado || 0),
                        cancelado: Number(stats.status_cancelado || 0)
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
                    ordersOver15Days: Number(stats.orders_over_15d || 0),
                    ordersOver30Days: Number(stats.orders_over_30d || 0),
                    totalRetainedValue,
                    oldestOrders
                },
                charts: {
                    salesTrend,
                    orderStatus,
                    warehouseTimeTrend: [{ month: 'Actual', days: 0 }],
                    comparison: {
                        category: 'Finanzas',
                        value1: Number(stats.monthly_income || 0),
                        value2: Number(stats.total_portfolio || 0)
                    },
                    ordersTrend: {
                        daily: ordersTrendDaily,
                        weekly: [],
                        monthly: []
                    }
                }
            });

        } catch (error) {
            console.error('GetDashboardSummaryUseCase ERROR DETAILS:', error);
            const msg = error instanceof Error ? error.message : 'Error desconocido';
            return Result.fail(`Error al generar resumen de dashboard: ${msg}`);
        }
    }
}
