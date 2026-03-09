import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();

router.get('/rules', authenticate, requirePermission('loyalty.view'), async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
        const skip = (page - 1) * limit;

        const [rules, total] = await Promise.all([
            prisma.loyaltyRule.findMany({
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.loyaltyRule.count()
        ]);
        res.json({
            success: true,
            data: rules,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});


router.post('/rules', authenticate, requirePermission('loyalty.manage_rules'), async (req, res, next) => {
    try {
        // Enforce single rule policy
        const existingRulesCount = await prisma.loyaltyRule.count();
        if (existingRulesCount >= 1) {
            res.status(400).json({ success: false, error: 'Ya existe una regla configurada. Elimine la actual antes de crear una nueva.' });
            return;
        }

        const { name, type, pointsValue, points_value, condition, active, isActive } = req.body;
        const rule = await prisma.loyaltyRule.create({
            data: {
                name,
                type,
                pointsValue: Number(pointsValue ?? points_value),
                condition: condition !== undefined && condition !== null ? String(condition) : null,
                isActive: isActive ?? active ?? true
            }
        });
        res.json({ success: true, data: rule });
    } catch (error) {
        next(error);
    }
});

router.put('/rules/:id', authenticate, requirePermission('loyalty.manage_rules'), async (req, res, next) => {
    try {
        const { name, type, pointsValue, points_value, condition, active, isActive } = req.body;
        const dataToUpdate: any = {};
        if (name !== undefined) dataToUpdate.name = name;
        if (type !== undefined) dataToUpdate.type = type;
        if (pointsValue !== undefined || points_value !== undefined) dataToUpdate.pointsValue = Number(pointsValue ?? points_value);
        if (condition !== undefined) dataToUpdate.condition = condition !== null ? String(condition) : null;
        if (isActive !== undefined || active !== undefined) dataToUpdate.isActive = isActive ?? active;

        const rule = await prisma.loyaltyRule.update({
            where: { id: req.params.id },
            data: dataToUpdate
        });
        res.json({ success: true, data: rule });
    } catch (error) {
        next(error);
    }
});

router.delete('/rules/:id', authenticate, requirePermission('loyalty.manage_rules'), async (req, res, next) => {
    try {
        await prisma.loyaltyRule.delete({
            where: { id: req.params.id }
        });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

router.get('/prizes', authenticate, requirePermission('loyalty.view'), async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
        const skip = (page - 1) * limit;

        const [prizes, total] = await Promise.all([
            prisma.loyaltyPrize.findMany({
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.loyaltyPrize.count()
        ]);
        res.json({
            success: true,
            data: prizes,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});


router.post('/prizes', authenticate, requirePermission('loyalty.manage_prizes'), async (req, res, next) => {
    try {
        const { name, description, type, pointsRequired, points_required, isActive, is_active } = req.body;
        const prize = await prisma.loyaltyPrize.create({
            data: {
                name,
                description,
                type,
                pointsRequired: Number(pointsRequired ?? points_required),
                isActive: isActive ?? is_active ?? true
            }
        });
        res.json({ success: true, data: prize });
    } catch (error) {
        next(error);
    }
});

router.put('/prizes/:id', authenticate, requirePermission('loyalty.manage_prizes'), async (req, res, next) => {
    try {
        const { name, description, type, pointsRequired, points_required, isActive, is_active } = req.body;
        const dataToUpdate: any = {};
        if (name !== undefined) dataToUpdate.name = name;
        if (description !== undefined) dataToUpdate.description = description;
        if (type !== undefined) dataToUpdate.type = type;
        if (pointsRequired !== undefined || points_required !== undefined) {
            dataToUpdate.pointsRequired = Number(pointsRequired ?? points_required);
        }
        if (isActive !== undefined || is_active !== undefined) {
            dataToUpdate.isActive = isActive ?? is_active;
        }

        const prize = await prisma.loyaltyPrize.update({
            where: { id: req.params.id },
            data: dataToUpdate
        });
        res.json({ success: true, data: prize });
    } catch (error) {
        next(error);
    }
});

router.delete('/prizes/:id', authenticate, requirePermission('loyalty.manage_prizes'), async (req, res, next) => {
    try {
        await prisma.loyaltyPrize.delete({
            where: { id: req.params.id }
        });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

router.post('/rules/:id/toggle', authenticate, requirePermission('loyalty.manage_rules'), async (req, res, next) => {
    try {
        const rule = await prisma.loyaltyRule.findUnique({ where: { id: req.params.id } });
        if (!rule) {
            res.status(404).json({ success: false, error: 'Regla no encontrada' });
            return;
        }

        const toggled = await prisma.loyaltyRule.update({
            where: { id: req.params.id },
            data: { isActive: !rule.isActive }
        });
        res.json({ success: true, data: toggled });
    } catch (error) {
        next(error);
    }
});

router.post('/prizes/:id/toggle', authenticate, requirePermission('loyalty.manage_prizes'), async (req, res, next) => {
    try {
        const prize = await prisma.loyaltyPrize.findUnique({ where: { id: req.params.id } });
        if (!prize) {
            res.status(404).json({ success: false, error: 'Premio no encontrado' });
            return;
        }

        const toggled = await prisma.loyaltyPrize.update({
            where: { id: req.params.id },
            data: { isActive: !prize.isActive }
        });
        res.json({ success: true, data: toggled });
    } catch (error) {
        next(error);
    }
});

router.get('/redemptions', authenticate, requirePermission('loyalty.view'), async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
        const skip = (page - 1) * limit;

        const [redemptions, total] = await Promise.all([
            (prisma.loyaltyRedemption as any).findMany({
                include: { author: true },
                orderBy: { date: 'desc' },
                skip,
                take: limit
            }),
            (prisma.loyaltyRedemption as any).count()
        ]);
        res.json({
            success: true,
            data: redemptions.map((r: any) => ({
                ...r,
                authorName: r.author?.name || 'Sistema'
            })),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        next(error);
    }
});

router.post('/redeem', authenticate, requirePermission('loyalty.manage_prizes'), async (req: any, res, next) => {
    try {
        const { clientId, client_id, prizeId, prize_id } = req.body;
        const authorId = req.user?.id;

        const targetClientId = clientId ?? client_id;
        const targetPrizeId = prizeId ?? prize_id;

        if (!targetClientId || !targetPrizeId) {
            res.status(400).json({ success: false, error: 'ID de cliente y premio son requeridos' });
            return;
        }

        // Find client and account
        const client = await prisma.client.findUnique({
            where: { id: targetClientId },
            include: { clientAccount: true }
        });

        if (!client || !client.clientAccount) {
            res.status(404).json({ success: false, error: 'Cliente o cuenta no encontrada' });
            return;
        }

        // Find prize
        const prize = await prisma.loyaltyPrize.findUnique({
            where: { id: targetPrizeId }
        });

        if (!prize || !prize.isActive) {
            res.status(400).json({ success: false, error: 'Premio inválido o inactivo' });
            return;
        }

        if (client.clientAccount.totalRewardPoints < prize.pointsRequired) {
            res.status(400).json({ success: false, error: 'Puntos insuficientes' });
            return;
        }

        // Apply redemption atomically
        const result = await prisma.$transaction(async (tx) => {
            // Reset points to 0 as requested: "una vez reclamado los puntos sean 0"
            await tx.clientAccount.update({
                where: { id: client.clientAccount!.id },
                data: {
                    totalRewardPoints: 0,
                    version: { increment: 1 }
                }
            });

            // Record redemption with authorId
            const redemption = await tx.loyaltyRedemption.create({
                data: {
                    clientId: client.id,
                    clientName: client.firstName.trim(),
                    prizeId: prize.id,
                    prizeName: prize.name,
                    pointsUsed: prize.pointsRequired,
                    status: 'COMPLETADO',
                    authorId: authorId || null
                }
            });

            return redemption;
        });

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

router.get('/history/:clientId', authenticate, requirePermission('loyalty.view'), async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
        const skip = (page - 1) * limit;

        const [history, total] = await Promise.all([
            prisma.rewardApplication.findMany({
                where: {
                    clientAccount: {
                        clientId: req.params.clientId
                    }
                },
                include: {
                    order: true
                },
                orderBy: {
                    appliedAt: 'desc'
                },
                skip,
                take: limit
            }),
            prisma.rewardApplication.count({
                where: {
                    clientAccount: {
                        clientId: req.params.clientId
                    }
                }
            })
        ]);
        res.json({
            success: true,
            data: history,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});


export default router;
