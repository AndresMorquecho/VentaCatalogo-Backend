import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const accounts = await prisma.clientAccount.findMany({
      include: {
        client: true,
        rewardApplications: {
          include: { order: true }
        }
      }
    });
    res.json({ success: true, data: accounts });
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

router.get('/history/all', authenticate, async (req, res, next) => {
  try {
    const history = await prisma.rewardApplication.findMany({
      include: {
        clientAccount: {
          include: { client: true }
        },
        order: true
      },
      orderBy: { appliedAt: 'desc' }
    });
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
});

export default router;
