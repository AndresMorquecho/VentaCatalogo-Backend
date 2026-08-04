import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';
import { Prisma } from '@prisma/client';

interface DashboardFilters {
    brandIds?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    period?: 'daily' | 'weekly' | 'monthly';
}

export class GetDashboardSummaryUseCase {
    async execute(filters: DashboardFilters = {}) {
        try {
            const ecuadorDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
            const today = new Date(`${ecuadorDateStr}T00:00:00.000-05:00`);
            const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const fifteenDaysAgo = new Date(today);
            fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            // ── Date range ─────────────────────────────────────────────────
            const rangeStart = filters.dateFrom ?? (() => {
                if (filters.period === 'weekly') {
                    const d = new Date(today);
                    d.setDate(d.getDate() - 6);
                    d.setHours(0, 0, 0, 0);
                    return d;
                } else if (filters.period === 'monthly') {
                    const d = new Date(today);
                    d.setDate(d.getDate() - 29);
                    d.setHours(0, 0, 0, 0);
                    return d;
                }
                // default to 'daily' (today)
                return today;
            })();
            const rangeEnd = filters.dateTo ?? tomorrow;

            const weeklyStart = filters.dateFrom ? rangeStart : new Date(rangeEnd.getTime() - 8 * 7 * 24 * 60 * 60 * 1000);
            const monthlyStart = filters.dateFrom ? rangeStart : new Date(rangeEnd.getTime() - 180 * 24 * 60 * 60 * 1000);

            // ── Brand filter fragment ──────────────────────────────────────
            // Support multiple brands with IN(...) or single brand with =
            const brandFilter = filters.brandIds && filters.brandIds.length > 0
                ? filters.brandIds.length === 1
                    ? Prisma.sql`AND o.brand_id = ${filters.brandIds[0]}`
                    : Prisma.sql`AND o.brand_id IN (${Prisma.join(filters.brandIds)})`
                : Prisma.sql``;

            // ── PARALLEL QUERIES ────────────────────────────────────────────
            const [statsRaw, trendRaw, ordersTrendRaw, weeklyTrendRaw, monthlyTrendRaw] = await Promise.all([

                // 1. Basic stats
                prisma.$queryRaw<any[]>`
                    SELECT
                        (SELECT COALESCE(SUM(amount), 0) FROM financial_records WHERE movement_type = 'INCOME' AND date >= ${today} AND date < ${tomorrow}) as daily_income,
                        (SELECT COALESCE(SUM(amount), 0) FROM financial_records WHERE movement_type = 'INCOME' AND date >= ${startOfMonth}) as monthly_income,
                        (SELECT COALESCE(SUM(fr.amount), 0) FROM financial_records fr LEFT JOIN orders o ON fr.order_id = o.id WHERE fr.movement_type = 'INCOME' AND fr.date >= ${rangeStart} AND fr.date < ${rangeEnd} ${brandFilter}) as current_cash,
                        (SELECT count(id) FROM clients WHERE is_active = true) as active_clients,
                        (SELECT count(o.id) FROM orders o WHERE o.status != 'CANCELADO' AND o.created_at >= ${rangeStart} AND o.created_at < ${rangeEnd} ${brandFilter}) as orders_in_range,
                        (SELECT count(o.id) FROM orders o WHERE o.status = 'ENTREGADO' AND o.created_at >= ${rangeStart} AND o.created_at < ${rangeEnd} ${brandFilter}) as total_delivered,
                        (SELECT count(o.id) FROM orders o WHERE o.status = 'POR_RECIBIR' AND o.created_at >= ${rangeStart} AND o.created_at < ${rangeEnd} ${brandFilter}) as status_por_recibir,
                        (SELECT count(o.id) FROM orders o WHERE o.status = 'RECIBIDO_EN_BODEGA' AND o.created_at >= ${rangeStart} AND o.created_at < ${rangeEnd} ${brandFilter}) as status_en_bodega,
                        (SELECT count(o.id) FROM orders o WHERE o.status = 'ENTREGADO' AND o.created_at >= ${rangeStart} AND o.created_at < ${rangeEnd} ${brandFilter}) as status_entregado,
                        (SELECT count(o.id) FROM orders o WHERE o.status = 'CANCELADO' AND o.created_at >= ${rangeStart} AND o.created_at < ${rangeEnd} ${brandFilter}) as status_cancelado,
                        (SELECT count(o.id) FROM orders o WHERE o.status = 'RECIBIDO_EN_BODEGA' AND o.reception_date <= ${fifteenDaysAgo} ${brandFilter}) as orders_over_15d,
                        (SELECT count(o.id) FROM orders o WHERE o.status = 'RECIBIDO_EN_BODEGA' AND o.reception_date <= ${thirtyDaysAgo} ${brandFilter}) as orders_over_30d,
                        (SELECT SUM(pending) FROM (
                            SELECT GREATEST(0, COALESCE(NULLIF(o.real_invoice_total, 0), o.total) - COALESCE(p.paid, 0)) as pending
                            FROM orders o
                            LEFT JOIN (SELECT order_id, SUM(amount) as paid FROM order_payments GROUP BY order_id) p ON o.id = p.order_id
                            WHERE o.status NOT IN ('CANCELADO', 'DESMANTELADO', 'ANULADO') AND o.created_at >= ${rangeStart} AND o.created_at < ${rangeEnd} ${brandFilter}
                        ) as portfolio) as total_portfolio
                `,

                // 2. Income trend by day in range
                prisma.$queryRaw<any[]>`
                    SELECT DATE(date) as day, SUM(amount) as amount
                    FROM financial_records
                    WHERE movement_type = 'INCOME' AND date >= ${rangeStart} AND date <= ${rangeEnd}
                    GROUP BY DATE(date)
                    ORDER BY day ASC
                `,

                // 3. Daily orders trend
                prisma.$queryRaw<any[]>`
                    SELECT
                        days.day,
                        COALESCE(c.created, 0) as created,
                        COALESCE(d.delivered, 0) as delivered
                    FROM (
                        SELECT generate_series(${rangeStart}::date, ${rangeEnd}::date, '1 day'::interval)::date as day
                    ) days
                    LEFT JOIN (
                        SELECT DATE(o.created_at) as day, COUNT(*) as created
                        FROM orders o WHERE o.created_at >= ${rangeStart} AND o.created_at < ${rangeEnd} ${brandFilter}
                        GROUP BY DATE(o.created_at)
                    ) c ON days.day = c.day
                    LEFT JOIN (
                        SELECT DATE(o.delivery_date) as day, COUNT(*) as delivered
                        FROM orders o WHERE o.status = 'ENTREGADO' AND o.delivery_date >= ${rangeStart} AND o.delivery_date < ${rangeEnd} ${brandFilter}
                        GROUP BY DATE(o.delivery_date)
                    ) d ON days.day = d.day
                    ORDER BY days.day ASC
                `,

                // 4. Weekly trend (dynamic range or last 8 weeks from rangeEnd)
                prisma.$queryRaw<any[]>`
                    SELECT
                        TO_CHAR(DATE_TRUNC('week', o.created_at), 'DD/MM') as week_label,
                        DATE_TRUNC('week', o.created_at) as week_start,
                        COUNT(*) as created,
                        COUNT(*) FILTER (WHERE o.status = 'ENTREGADO') as delivered
                    FROM orders o
                    WHERE o.created_at >= ${weeklyStart}
                      AND o.created_at < ${rangeEnd}
                      ${brandFilter}
                    GROUP BY DATE_TRUNC('week', o.created_at)
                    ORDER BY week_start ASC
                `,

                // 5. Monthly trend (dynamic range or last 6 months from rangeEnd)
                prisma.$queryRaw<any[]>`
                    SELECT
                        TO_CHAR(DATE_TRUNC('month', o.created_at), 'Mon') as month_label,
                        DATE_TRUNC('month', o.created_at) as month_start,
                        COUNT(*) as created,
                        COUNT(*) FILTER (WHERE o.status = 'ENTREGADO') as delivered
                    FROM orders o
                    WHERE o.created_at >= ${monthlyStart}
                      AND o.created_at < ${rangeEnd}
                      ${brandFilter}
                    GROUP BY DATE_TRUNC('month', o.created_at)
                    ORDER BY month_start ASC
                `
            ]);

            const stats = statsRaw[0] || {};

            // ── Oldest orders (brand-filtered via Prisma ORM) ────────────────
            const oldestOrdersRaw = await prisma.order.findMany({
                where: {
                    status: 'RECIBIDO_EN_BODEGA',
                    receptionDate: { lte: fifteenDaysAgo },
                    ...(filters.brandIds && filters.brandIds.length > 0 ? { brandId: { in: filters.brandIds } } : {})
                },
                orderBy: { receptionDate: 'asc' },
                take: 5,
                select: { id: true, receiptNumber: true, clientName: true, receptionDate: true, total: true, realInvoiceTotal: true }
            });

            // ── Transforms ───────────────────────────────────────────────────
            const salesTrend = trendRaw.map(t => ({
                date: `${new Date(t.day).getDate().toString().padStart(2, '0')}/${(new Date(t.day).getMonth() + 1).toString().padStart(2, '0')}`,
                amount: Number(t.amount)
            }));

            const ordersTrendDaily = ordersTrendRaw.map(t => ({
                period: `${new Date(t.day).getDate().toString().padStart(2, '0')}/${(new Date(t.day).getMonth() + 1).toString().padStart(2, '0')}`,
                created: Number(t.created),
                delivered: Number(t.delivered)
            }));

            const ordersTrendWeekly = weeklyTrendRaw.map(t => ({
                period: `Sem ${t.week_label}`,
                created: Number(t.created),
                delivered: Number(t.delivered)
            }));

            const ordersTrendMonthly = monthlyTrendRaw.map(t => ({
                period: t.month_label,
                created: Number(t.created),
                delivered: Number(t.delivered)
            }));

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

            const orderStatus = [
                { status: 'Por Recibir', count: Number(stats.status_por_recibir || 0), color: '#F59E0B' },
                { status: 'En Bodega',   count: Number(stats.status_en_bodega   || 0), color: '#3B82F6' },
                { status: 'Entregado',   count: Number(stats.status_entregado   || 0), color: '#10B981' },
                { status: 'Cancelado',   count: Number(stats.status_cancelado   || 0), color: '#EF4444' }
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
                    ordersReceivedToday: Number(stats.orders_in_range || 0),
                    ordersPending: Number(stats.status_por_recibir || 0),
                    ordersInWarehouse: Number(stats.status_en_bodega || 0),
                    ordersDeliveredToday: Number(stats.total_delivered || 0),
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
                tracking: { ordersWithoutCall7Days: 0, callsMadeToday: 0, clientsWithoutRecentFollowup: 0 },
                loyalty: { pointsGeneratedThisMonth: 0, topClients: [], redemptionsMade: 0 },
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
                        weekly: ordersTrendWeekly,
                        monthly: ordersTrendMonthly
                    }
                }
            });

        } catch (error) {
            console.error('GetDashboardSummaryUseCase ERROR:', error);
            const msg = error instanceof Error ? error.message : 'Error desconocido';
            return Result.fail(`Error al generar resumen de dashboard: ${msg}`);
        }
    }
}
