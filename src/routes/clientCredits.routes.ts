import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { HttpResponse } from '../shared/infrastructure/http/HttpResponse';

const router = Router();

// GET /api/client-credits/summary
router.get('/summary', authenticate, async (req: AuthRequest, res) => {
    try {
        const clientAccounts = await prisma.clientAccount.findMany({
            where: {
                credits: {
                    some: {
                        status: 'AVAILABLE'
                    }
                }
            },
            include: {
                client: true,
                credits: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        const summaries = clientAccounts.map(account => {
            const credits = account.credits;
            const availableCredits = credits.filter(c => c.status === 'AVAILABLE');

            const totalCredit = availableCredits.reduce((sum, c) => sum + Number(c.remainingAmount), 0);
            const totalGenerated = credits.reduce((sum, c) => sum + Number(c.amount), 0);
            const totalUsed = totalGenerated - totalCredit;

            return {
                clientId: account.clientId,
                clientName: account.client.firstName,
                clientIdentification: account.client.identificationNumber,
                clientPhone: account.client.phone1,
                totalCredit,
                totalGenerated,
                totalUsed,
                lastUpdated: credits.length > 0 ? credits[0].createdAt : account.updatedAt,
                credits: availableCredits.map(c => ({
                    id: c.id,
                    amount: Number(c.remainingAmount),
                    originTransactionId: c.originTransactionId,
                    createdAt: c.createdAt
                }))
            };
        });

        const filteredSummaries = summaries
            .filter(s => s.totalCredit > 0.01)
            .sort((a, b) => b.totalCredit - a.totalCredit);

        return HttpResponse.ok(res, filteredSummaries);
    } catch (error) {
        return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error fetching client credits summary');
    }
});

// GET /api/client-credits
router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
        const clientId = req.query.clientId as string;
        const status = req.query.status as string;

        const where: any = {};
        if (clientId) {
            const accounts = await prisma.clientAccount.findMany({ where: { clientId } });
            where.clientAccountId = { in: accounts.map(acc => acc.id) };
        }
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

// POST /api/client-credits/:id/use
router.post('/:id/use', authenticate, async (req: AuthRequest, res) => {
    try {
        const { amountToUse } = req.body;
        const creditId = req.params.id;

        if (amountToUse === undefined || amountToUse <= 0) {
            return HttpResponse.badRequest(res, 'Invalid amount to use');
        }

        const credit = await prisma.clientCredit.findUnique({
            where: { id: creditId }
        });

        if (!credit) {
            return HttpResponse.notFound(res, 'Credit not found');
        }

        if (Number(credit.remainingAmount) < amountToUse) {
            return HttpResponse.badRequest(res, 'Insufficient credit amount');
        }

        const updatedCredit = await prisma.clientCredit.update({
            where: { id: creditId },
            data: {
                remainingAmount: { decrement: amountToUse },
                status: Number(credit.remainingAmount) - amountToUse <= 0.01 ? 'USED' : 'AVAILABLE'
            }
        });

        return HttpResponse.ok(res, updatedCredit);
    } catch (error) {
        return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error using credit');
    }
});

export default router;
