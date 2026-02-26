import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();

router.get('/movements', authenticate, requirePermission('inventory.view'), async (req, res, next) => {
  try {
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        type: req.query.type as string | undefined,
        brandId: req.query.brandId as string | undefined,
        orderId: req.query.orderId as string | undefined
      },
      include: {
        order: true,
        client: true,
        brand: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: movements });
  } catch (error) {
    next(error);
  }
});

export default router;
