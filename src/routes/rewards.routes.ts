import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
    const skip = (page - 1) * limit;

    const [accounts, total] = await Promise.all([
      prisma.clientAccount.findMany({
        include: {
          client: true,
          rewardApplications: {
            include: { order: true }
          }
        },
        skip,
        take: limit
      }),
      prisma.clientAccount.count()
    ]);

    res.json({
      success: true,
      data: accounts,
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

router.get('/history/all', authenticate, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
    const skip = (page - 1) * limit;

    const [history, total] = await Promise.all([
      prisma.rewardApplication.findMany({
        include: {
          clientAccount: {
            include: { client: true }
          },
          order: true
        },
        orderBy: { appliedAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.rewardApplication.count()
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

router.get('/:clientId', authenticate, async (req, res, next) => {
  try {
    const account = await prisma.clientAccount.findUnique({
      where: { clientId: req.params.clientId },
      include: {
        client: true,
        credits: {
          where: { status: 'AVAILABLE' }
        },
        rewardApplications: {
          include: { order: true }
        }
      }
    });
    res.json({ success: true, data: account });
  } catch (error) {
    next(error);
  }
});

export default router;
