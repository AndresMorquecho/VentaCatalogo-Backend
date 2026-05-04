import { Router } from 'express';
import { authenticate, authorize, requirePermission } from '../../../middleware/auth';
import { CashClosureController } from './CashClosureController';
import { GetCashClosuresUseCase } from '../application/GetCashClosures.usecase';
import { CreateCashClosureUseCase } from '../application/CreateCashClosure.usecase';
import { GetCashClosurePreviewUseCase } from '../application/GetCashClosurePreview.usecase';
import { PrismaCashClosureRepository } from './PrismaCashClosureRepository';

const router = Router();

// Dependencies
const cashClosureRepository = new PrismaCashClosureRepository();
const getCashClosuresUseCase = new GetCashClosuresUseCase(cashClosureRepository);
const createCashClosureUseCase = new CreateCashClosureUseCase(cashClosureRepository);
const getCashClosurePreviewUseCase = new GetCashClosurePreviewUseCase(cashClosureRepository);

const controller = new CashClosureController(
    getCashClosuresUseCase,
    createCashClosureUseCase,
    getCashClosurePreviewUseCase,
    cashClosureRepository
);

import { prisma } from '../../../lib/prisma';

// Routes
router.get('/', authenticate, requirePermission('cash_closure.view'), (req: any, res, next) => controller.getAll(req, res, next));

// New user cash closure routes
router.get('/user', authenticate, async (req: any, res, next) => {
    try {
        const { userId, fromDate, toDate } = req.query;
        if (!userId) {
            const userClosures = await prisma.userCashClosure.findMany({
                orderBy: { closedAt: 'desc' }
            });
            return res.json(userClosures);
        }

        const where: any = { userId };
        if (fromDate && toDate) {
            where.OR = [
                { fromDate: { lte: new Date(fromDate) }, toDate: { gte: new Date(fromDate) } },
                { fromDate: { lte: new Date(toDate) }, toDate: { gte: new Date(toDate) } },
                { fromDate: { gte: new Date(fromDate) }, toDate: { lte: new Date(toDate) } }
            ];
        }

        const closures = await prisma.userCashClosure.findMany({
            where,
            orderBy: { closedAt: 'desc' }
        });
        return res.json(closures);
    } catch (error) {
        return next(error);
    }
});

router.post('/user', authenticate, async (req: any, res, next) => {
    try {
        const { userId, username, fromDate, toDate, expectedAmount, actualAmount, difference, notes } = req.body;
        const receivedBy = req.user?.username || 'Admin';

        const existing = await prisma.userCashClosure.findFirst({
            where: {
                userId,
                fromDate: new Date(fromDate),
                toDate: new Date(toDate)
            }
        });

        if (existing) {
            return res.status(400).json({ message: 'Este periodo ya fue cerrado para este usuario' });
        }

        const closure = await prisma.userCashClosure.create({
            data: {
                userId,
                username,
                fromDate: new Date(fromDate),
                toDate: new Date(toDate),
                notes,
                expectedAmount: Number(expectedAmount) || 0,
                actualAmount: Number(actualAmount) || 0,
                difference: Number(difference) || 0,
                receivedBy
            }
        });

        return res.status(201).json(closure);
    } catch (error) {
        return next(error);
    }
});

router.delete('/user/:id', authenticate, async (req: any, res, next) => {
    try {
        await prisma.userCashClosure.delete({
            where: { id: req.params.id }
        });
        return res.status(204).send();
    } catch (error) {
        return next(error);
    }
});

router.put('/user/:id', authenticate, async (req: any, res, next) => {
    try {
        const { actualAmount, expectedAmount, difference, notes } = req.body;
        const closure = await prisma.userCashClosure.update({
            where: { id: req.params.id },
            data: {
                actualAmount: actualAmount !== undefined ? Number(actualAmount) : undefined,
                expectedAmount: expectedAmount !== undefined ? Number(expectedAmount) : undefined,
                difference: difference !== undefined ? Number(difference) : undefined,
                notes: notes !== undefined ? notes : undefined
            }
        });
        return res.json(closure);
    } catch (error) {
        return next(error);
    }
});

router.get('/preview', authenticate, requirePermission('cash_closure.view'), (req: any, res, next) => controller.getPreview(req, res, next));
router.get('/:id', authenticate, requirePermission('cash_closure.view'), (req: any, res, next) => controller.getById(req, res, next));
router.post('/', authenticate, requirePermission('cash_closure.close'), (req: any, res, next) => controller.create(req, res, next));
router.delete('/:id', authenticate, requirePermission('cash_closure.delete'), (req: any, res, next) => controller.delete(req, res, next));

export default router;
