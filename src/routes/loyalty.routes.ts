import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requirePermission } from '../middleware/auth';
import { Prisma } from '@prisma/client';
import { differenceInDays, addDays, isAfter } from 'date-fns';

const router = Router();

// ============================================================================
// RULES MANAGEMENT
// ============================================================================

router.get('/rules', authenticate, requirePermission(['loyalty.view', 'orders.view', 'orders.create']), async (req, res, next) => {
    try {
        const rules = await prisma.loyaltyRule.findMany({
            include: {
                brands: { include: { brand: true } },
                prize: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, data: rules });
    } catch (error) {
        next(error);
    }
});

router.post('/rules', authenticate, requirePermission('loyalty.manage_rules'), async (req, res, next) => {
    try {
        const { 
            name, 
            description, 
            type, 
            target_value, 
            reset_days, 
            is_active, 
            prize_id, 
            brand_ids 
        } = req.body;

        const rule = await prisma.loyaltyRule.create({
            data: {
                name,
                description,
                type,
                targetValue: new Prisma.Decimal(target_value || 0),
                resetDays: reset_days ? parseInt(reset_days) : null,
                isActive: is_active ?? true,
                prizeId: prize_id,
                brands: {
                    create: (brand_ids || []).map((id: string) => ({
                        brandId: id
                    }))
                }
            },
            include: {
                brands: { include: { brand: true } }
            }
        });
        res.json({ success: true, data: rule });
    } catch (error) {
        next(error);
    }
});

router.put('/rules/:id', authenticate, requirePermission('loyalty.manage_rules'), async (req, res, next) => {
    try {
        const { 
            name, 
            description, 
            type, 
            target_value, 
            reset_days, 
            is_active, 
            prize_id, 
            brand_ids 
        } = req.body;

        const rule = await prisma.loyaltyRule.update({
            where: { id: req.params.id },
            data: {
                name,
                description,
                type,
                targetValue: target_value !== undefined ? new Prisma.Decimal(target_value) : undefined,
                resetDays: reset_days !== undefined ? (reset_days ? parseInt(reset_days) : null) : undefined,
                isActive: is_active,
                prizeId: prize_id,
                brands: brand_ids ? {
                    deleteMany: {},
                    create: brand_ids.map((id: string) => ({
                        brandId: id
                    }))
                } : undefined
            }
        });
        res.json({ success: true, data: rule });
    } catch (error) {
        next(error);
    }
});

router.delete('/rules/:id', authenticate, requirePermission('loyalty.manage_rules'), async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check for redemptions
        const redemptionsCount = await prisma.loyaltyRedemption.count({
            where: { ruleId: id }
        });

        if (redemptionsCount > 0) {
            res.status(400).json({ 
                success: false, 
                error: 'Esta regla ya tiene historial de canjes. No se puede eliminar.' 
            });
            return;
        }

        await prisma.loyaltyRule.delete({ where: { id } });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// ============================================================================
// BALANCES & PROGRESS
// ============================================================================

router.get('/balances', authenticate, requirePermission('loyalty.view'), async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;
        const search = req.query.search as string;

        // Fetch active rules
        const rules = await prisma.loyaltyRule.findMany({
            where: { isActive: true },
            include: { brands: true, prize: true }
        });

        const activeBrandIds = Array.from(new Set(rules.flatMap(r => r.brands.map(b => b.brandId))));

        // Fetch clients with at least one order that could count towards active rules
        const clientWhere: Prisma.ClientWhereInput = {
            orders: {
                some: {
                    status: 'ENTREGADO',
                    loyaltyRedemptionId: null,
                    brandId: { in: activeBrandIds }
                }
            }
        };

        if (search) {
            clientWhere.OR = [
                { firstName: { contains: search, mode: 'insensitive' } },
                { identificationNumber: { contains: search, mode: 'insensitive' } }
            ];
        }

        const [clients, total] = await Promise.all([
            prisma.client.findMany({
                where: clientWhere,
                include: {
                    orders: {
                        where: {
                            status: 'ENTREGADO',
                            loyaltyRedemptionId: null
                        },
                        orderBy: { createdAt: 'asc' }
                    }
                },
                skip,
                take: limit
            }),
            prisma.client.count({ where: clientWhere })
        ]);

        const balances = clients.map(client => {
            const ruleProgress = rules.map(rule => {
                const participatingBrandIds = rule.brands.map(b => b.brandId);
                
                // Filter orders for this rule
                let eligibleOrders = client.orders.filter(o => participatingBrandIds.includes(o.brandId));
                
                // Expiry filter
                let expiringSoon: number | null = null;
                if (rule.resetDays && eligibleOrders.length > 0) {
                    const now = new Date();
                    const cutoff = addDays(now, -rule.resetDays);
                    eligibleOrders = eligibleOrders.filter(o => o.createdAt >= cutoff);
                    
                    if (eligibleOrders.length > 0) {
                        const firstOrder = eligibleOrders[0];
                        const expiryDate = addDays(firstOrder.createdAt, rule.resetDays);
                        expiringSoon = differenceInDays(expiryDate, now);
                    }
                }

                const currentCount = eligibleOrders.length;
                const currentAmount = eligibleOrders.reduce((sum, o) => sum.plus(o.realInvoiceTotal || o.total), new Prisma.Decimal(0));

                const target = Number(rule.targetValue);
                let progress = 0;
                let missing = 0;

                if (rule.type === 'POR_MONTO') {
                    progress = Math.min(100, (currentAmount.toNumber() / target) * 100);
                    missing = Math.max(0, target - currentAmount.toNumber());
                } else {
                    progress = Math.min(100, (currentCount / target) * 100);
                    missing = Math.max(0, target - currentCount);
                }

                return {
                    ruleId: rule.id,
                    ruleName: rule.name,
                    prizeName: rule.prize?.name,
                    type: rule.type,
                    progress,
                    current: rule.type === 'POR_MONTO' ? currentAmount.toNumber() : currentCount,
                    target,
                    missing,
                    expiringDays: expiringSoon,
                    canRedeem: progress >= 100,
                    eligibleOrderIds: eligibleOrders.map(o => o.id)
                };
            }).filter(p => p.current > 0); // Only return rules client has progress in

            return {
                id: client.id,
                name: client.firstName,
                idNumber: client.identificationNumber,
                rules: ruleProgress
            };
        }).filter(b => b.rules.length > 0); // Only show clients with at least one active progress

        res.json({
            success: true,
            data: balances,
            pagination: {
                page, limit, total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});

// ============================================================================
// REDEMPTIONS & HISTORY
// ============================================================================

router.get('/redemptions', authenticate, requirePermission('loyalty.view'), async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 15));
        const skip = (page - 1) * limit;

        const { search, startDate, endDate, brandId } = req.query;

        const whereClause: Prisma.LoyaltyRedemptionWhereInput = {};

        if (search) {
            whereClause.OR = [
                { clientName: { contains: search as string, mode: 'insensitive' } },
                { clientId: { contains: search as string, mode: 'insensitive' } }
            ];
        }

        if (startDate && endDate) {
            whereClause.date = {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string)
            };
        }

        if (brandId && brandId !== 'ALL') {
            whereClause.rule = {
                brands: {
                    some: { brandId: brandId as string }
                }
            };
        }

        const [data, total] = await Promise.all([
            prisma.loyaltyRedemption.findMany({
                where: whereClause,
                include: {
                    author: { select: { username: true } },
                    prize: true,
                    rule: { select: { type: true } }
                },
                orderBy: { date: 'desc' },
                skip,
                take: limit
            }),
            prisma.loyaltyRedemption.count({ where: whereClause })
        ]);

        const formattedData = data.map(r => ({
            ...r,
            pointsUsed: r.valueClaimed ? Number(r.valueClaimed) : 0,
            authorName: r.author?.username,
            ruleType: r.rule?.type
        }));

        res.json({
            success: true,
            data: formattedData,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        next(error);
    }
});

router.get('/history/:clientId', authenticate, requirePermission('loyalty.view'), async (req, res, next) => {
    try {
        const { clientId } = req.params;
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
        const skip = (page - 1) * limit;

        // Fetch active rules to compute per-rule progress history
        const rules = await prisma.loyaltyRule.findMany({
            where: { isActive: true },
            include: { brands: true, prize: true }
        });

        // All orders for this client (delivered, including redeemed ones)
        const allOrders = await prisma.order.findMany({
            where: { clientId, status: 'ENTREGADO' },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                receiptNumber: true,
                orderNumber: true,
                total: true,
                realInvoiceTotal: true,
                brandId: true,
                createdAt: true,
                loyaltyRedemptionId: true
            }
        });

        // Redemptions for this client
        const [redemptions, redemptionTotal] = await Promise.all([
            prisma.loyaltyRedemption.findMany({
                where: { clientId },
                include: { prize: true, rule: true },
                orderBy: { date: 'desc' },
                skip,
                take: limit
            }),
            prisma.loyaltyRedemption.count({ where: { clientId } })
        ]);

        // Build per-rule progress for each rule
        const ruleProgress = rules.map(rule => {
            const participatingBrandIds = rule.brands.map(b => b.brandId);
            const eligibleOrders = allOrders.filter(o =>
                participatingBrandIds.includes(o.brandId) && !o.loyaltyRedemptionId
            );

            let windowOrders = eligibleOrders;
            if (rule.resetDays && eligibleOrders.length > 0) {
                const cutoff = addDays(new Date(), -rule.resetDays);
                windowOrders = eligibleOrders.filter(o => o.createdAt >= cutoff);
            }

            const currentCount = windowOrders.length;
            const currentAmount = windowOrders.reduce((sum, o) => sum + Number(o.realInvoiceTotal || o.total), 0);
            const target = Number(rule.targetValue);
            const current = rule.type === 'POR_MONTO' ? currentAmount : currentCount;
            const progress = Math.min(100, (current / target) * 100);

            // Expiry
            let expiringDays: number | null = null;
            if (rule.resetDays && windowOrders.length > 0) {
                const firstOrder = windowOrders[0];
                const expiryDate = addDays(firstOrder.createdAt, rule.resetDays);
                expiringDays = differenceInDays(expiryDate, new Date());
            }

            return {
                ruleId: rule.id,
                ruleName: rule.name,
                ruleType: rule.type,
                prizeName: rule.prize?.name || null,
                target,
                current,
                progress,
                canRedeem: progress >= 100,
                expiringDays,
                contributingOrders: windowOrders.map(o => ({
                    id: o.id,
                    receiptNumber: o.receiptNumber,
                    orderNumber: o.orderNumber,
                    amount: Number(o.realInvoiceTotal || o.total),
                    date: o.createdAt
                }))
            };
        }).filter(r => r.current > 0);

        // Redemption history with consumed orders
        const redemptionHistory = redemptions.map(r => ({
            id: r.id,
            date: r.date,
            prizeName: r.prizeName,
            ruleName: r.rule?.name || null,
            ruleType: r.rule?.type || null,
            valueClaimed: r.valueClaimed ? Number(r.valueClaimed) : null,
            status: r.status,
            consumedOrdersCount: allOrders.filter(o => o.loyaltyRedemptionId === r.id).length
        }));

        res.json({
            success: true,
            data: {
                ruleProgress,
                redemptionHistory,
            },
            pagination: { page, limit, total: redemptionTotal, pages: Math.ceil(redemptionTotal / limit) }
        });
    } catch (error) {
        next(error);
    }
});

// ============================================================================
// REDEMPTION
// ============================================================================

router.post('/redeem', authenticate, requirePermission('loyalty.manage_prizes'), async (req: any, res, next) => {
    try {
        const { client_id: clientId, rule_id: ruleId } = req.body;
        const authorId = req.user?.id;

        const rule = await prisma.loyaltyRule.findUnique({
            where: { id: ruleId },
            include: { brands: true, prize: true }
        });

        if (!rule || !rule.isActive) {
            res.status(400).json({ success: false, error: 'Regla inválida o inactiva' });
            return;
        }

        const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: {
                orders: {
                    where: {
                        status: 'ENTREGADO',
                        loyaltyRedemptionId: null,
                        brandId: { in: rule.brands.map(b => b.brandId) }
                    },
                    orderBy: { createdAt: 'asc' }
                }
            }
        });

        if (!client) {
            res.status(404).json({ success: false, error: 'Cliente no encontrado' });
            return;
        }

        let eligibleOrders = client.orders;
        if (rule.resetDays) {
            const cutoff = addDays(new Date(), -rule.resetDays);
            eligibleOrders = eligibleOrders.filter(o => o.createdAt >= cutoff);
        }

        const currentCount = eligibleOrders.length;
        const currentAmount = eligibleOrders.reduce((sum, o) => sum.plus(o.realInvoiceTotal || o.total), new Prisma.Decimal(0));
        const target = Number(rule.targetValue);

        const isEligible = rule.type === 'POR_MONTO' ? currentAmount.gte(target) : currentCount >= target;

        if (!isEligible) {
            res.status(400).json({ success: false, error: 'No cumple con los requisitos de la regla' });
            return;
        }

        // Apply redemption
        const result = await prisma.$transaction(async (tx) => {
            const redemption = await tx.loyaltyRedemption.create({
                data: {
                    clientId: client.id,
                    clientName: client.firstName,
                    ruleId: rule.id,
                    prizeId: rule.prizeId || '', // Should ideally always have a prize
                    prizeName: rule.prize?.name || 'Premio de Regla',
                    valueClaimed: rule.type === 'POR_MONTO' ? currentAmount : new Prisma.Decimal(currentCount),
                    status: 'COMPLETADO',
                    authorId: authorId || null
                }
            });

            // Consume orders: user said "vaciar para que no participe en otras"
            // We mark all eligible orders used for this redemption
            await tx.order.updateMany({
                where: {
                    id: { in: eligibleOrders.map(o => o.id) }
                },
                data: {
                    loyaltyRedemptionId: redemption.id
                }
            });

            return redemption;
        });

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// Prizes CRUD (Redirected/Kept from before but updated for new schema)
router.get('/prizes', authenticate, requirePermission('loyalty.view'), async (req, res, next) => {
    try {
        const prizes = await prisma.loyaltyPrize.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, data: prizes });
    } catch (error) {
        next(error);
    }
});

router.post('/prizes', authenticate, requirePermission('loyalty.manage_prizes'), async (req, res, next) => {
    try {
        const { name, description, points_required: pointsRequired, is_active: isActive } = req.body;
        const prize = await prisma.loyaltyPrize.create({
            data: {
                name, description, type: 'ENVIO_GRATIS',
                pointsRequired: pointsRequired ? parseInt(pointsRequired) : null,
                isActive: isActive ?? true
            }
        });
        res.json({ success: true, data: prize });
    } catch (error) {
        next(error);
    }
});

router.put('/prizes/:id', authenticate, requirePermission('loyalty.manage_prizes'), async (req, res, next) => {
    try {
        const { name, description, points_required: pointsRequired, is_active: isActive } = req.body;
        const prize = await prisma.loyaltyPrize.update({
            where: { id: req.params.id },
            data: { name, description, pointsRequired: pointsRequired ? parseInt(pointsRequired) : null, isActive }
        });
        res.json({ success: true, data: prize });
    } catch (error) {
        next(error);
    }
});

router.delete('/prizes/:id', authenticate, requirePermission('loyalty.manage_prizes'), async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if prize has associated rules
        const rulesCount = await prisma.loyaltyRule.count({
            where: { prizeId: id }
        });

        if (rulesCount > 0) {
            res.status(400).json({ 
                success: false, 
                error: 'Este premio tiene una regla asociada. Elimine o edite primero la regla para poder eliminar el premio.' 
            });
            return;
        }

        // Check if prize has redemptions
        const redemptionsCount = await prisma.loyaltyRedemption.count({
            where: { prizeId: id }
        });

        if (redemptionsCount > 0) {
            res.status(400).json({ 
                success: false, 
                error: 'Este premio ya ha sido canjeado y tiene historial. No se puede eliminar.' 
            });
            return;
        }

        await prisma.loyaltyPrize.delete({ where: { id } });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

export default router;
