import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const calls = await prisma.call.findMany({
      where: {
        clientId: req.query.clientId as string | undefined,
        orderId: req.query.orderId as string | undefined
      },
      include: {
        client: true,
        order: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: calls });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const call = await prisma.call.create({
      data: {
        ...req.body,
        createdBy: req.user!.email
      }
    });
    res.status(201).json({ success: true, data: call });
  } catch (error) {
    next(error);
  }
});

export default router;
