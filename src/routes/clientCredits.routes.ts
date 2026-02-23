import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { HttpResponse } from '../shared/infrastructure/http/HttpResponse';

const router = Router();

// GET /api/client-credits
router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
        const clientId = req.query.clientId as string;
        const status = req.query.status as string;

        const where: any = {};
        if (clientId) where.clientAccountId = { in: await prisma.clientAccount.findMany({ where: { clientId } }).then(a => a.map(acc => acc.id)) };
        if (status) where.status = status;

        const credits = await prisma.clientCredit.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        return HttpResponse.ok(res, credits);
    } catch (error) {
        return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error fetching client credits');
    }
});

// POST /api/client-credits
router.post('/', authenticate, async (req: AuthRequest, res) => {
    try {
        const { clientId, amount, originTransactionId } = req.body;

        if (!clientId || amount === undefined) {
            return HttpResponse.badRequest(res, 'Missing required fields');
        }

        const account = await prisma.clientAccount.findUnique({
            where: { clientId }
        });

        if (!account) {
            return HttpResponse.notFound(res, 'Client account not found');
        }

        const credit = await prisma.clientCredit.create({
            data: {
                clientAccountId: account.id,
                amount: Number(amount),
                remainingAmount: Number(amount),
                originTransactionId,
                status: 'AVAILABLE'
            }
        });

        return HttpResponse.created(res, credit);
    } catch (error) {
        return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error creating credit');
    }
});

export default router;
