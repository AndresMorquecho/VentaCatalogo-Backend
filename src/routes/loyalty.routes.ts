import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/rules', authenticate, async (req, res, next) => {
    try {
        const rules = await prisma.loyaltyRule.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, data: rules });
    } catch (error) {
        next(error);
    }
});

router.post('/rules', authenticate, async (req, res, next) => {
    try {
        const rule = await prisma.loyaltyRule.create({
            data: req.body
        });
        res.json({ success: true, data: rule });
    } catch (error) {
        next(error);
    }
});

router.put('/rules/:id', authenticate, async (req, res, next) => {
    try {
        const rule = await prisma.loyaltyRule.update({
            where: { id: req.params.id },
            data: req.body
        });
        res.json({ success: true, data: rule });
    } catch (error) {
        next(error);
    }
});

router.delete('/rules/:id', authenticate, async (req, res, next) => {
    try {
        await prisma.loyaltyRule.delete({
            where: { id: req.params.id }
        });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

router.get('/prizes', authenticate, async (req, res, next) => {
    try {
        const prizes = await prisma.loyaltyPrize.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, data: prizes });
    } catch (error) {
        next(error);
    }
});

router.post('/prizes', authenticate, async (req, res, next) => {
    try {
        const prize = await prisma.loyaltyPrize.create({
            data: req.body
        });
        res.json({ success: true, data: prize });
    } catch (error) {
        next(error);
    }
});

router.put('/prizes/:id', authenticate, async (req, res, next) => {
    try {
        const prize = await prisma.loyaltyPrize.update({
            where: { id: req.params.id },
            data: req.body
        });
        res.json({ success: true, data: prize });
    } catch (error) {
        next(error);
    }
});

router.delete('/prizes/:id', authenticate, async (req, res, next) => {
    try {
        await prisma.loyaltyPrize.delete({
            where: { id: req.params.id }
        });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

export default router;
