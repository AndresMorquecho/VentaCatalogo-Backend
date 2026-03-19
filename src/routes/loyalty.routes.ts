import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requirePermission } from '../middleware/auth';
import { Prisma } from '@prisma/client';
import { differenceInDays, addDays, isAfter } from 'date-fns';

const router = Router();

// ============================================================================
// RULES MANAGEMENT
// ============================================================================

router.get('/rules', authenticate, requirePermission('loyalty.view'), async (req, res, next) => {
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
        await prisma.loyaltyRule.delete({ where: { id: req.params.id } });
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
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            prisma.loyaltyRedemption.findMany({
                include: {
                    author: { select: { username: true } },
                    prize: true
                },
                orderBy: { date: 'desc' },
                skip,
                take: limit
            }),
            prisma.loyaltyRedemption.count()
        ]);

        res.json({
            success: true,
            data,
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
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            prisma.loyaltyRedemption.findMany({
                where: { clientId },
                include: { prize: true },
                orderBy: { date: 'desc' },
                skip,
                take: limit
            }),
            prisma.loyaltyRedemption.count({ where: { clientId } })
        ]);

        res.json({
            success: true,
            data,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) }
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
        const { name, description, type, points_required: pointsRequired, is_active: isActive } = req.body;
        const prize = await prisma.loyaltyPrize.create({
            data: {
                name, description, type,
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
        const { name, description, type, points_required: pointsRequired, is_active: isActive } = req.body;
        const prize = await prisma.loyaltyPrize.update({
            where: { id: req.params.id },
            data: { name, description, type, pointsRequired: pointsRequired ? parseInt(pointsRequired) : null, isActive }
        });
        res.json({ success: true, data: prize });
    } catch (error) {
        next(error);
    }
});

router.delete('/prizes/:id', authenticate, requirePermission('loyalty.manage_rules'), async (req, res, next) => {
    try {
        await prisma.loyaltyPrize.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

export default router;
