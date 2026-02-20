import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/metrics', authenticate, async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Financial metrics
    const dailyIncome = await prisma.financialRecord.aggregate({
      where: {
        movementType: 'INCOME',
        date: { gte: today, lt: tomorrow }
      },
      _sum: { amount: true }
    });

    const monthlyIncome = await prisma.financialRecord.aggregate({
      where: {
        movementType: 'INCOME',
        date: { gte: startOfMonth }
      },
      _sum: { amount: true }
    });

    const currentCash = await prisma.bankAccount.aggregate({
      where: { isActive: true },
      _sum: { currentBalance: true }
    });

    // Operational metrics
    const ordersReceivedToday = await prisma.order.count({
      where: {
        status: 'RECIBIDO_EN_BODEGA',
        receptionDate: { gte: today, lt: tomorrow }
      }
    });

    const ordersPending = await prisma.order.count({
      where: { status: 'POR_RECIBIR' }
    });

    const ordersInWarehouse = await prisma.order.count({
      where: { status: 'RECIBIDO_EN_BODEGA' }
    });

    const ordersDeliveredToday = await prisma.order.count({
      where: {
        status: 'ENTREGADO',
        deliveryDate: { gte: today, lt: tomorrow }
      }
    });

    const totalActiveClients = await prisma.client.count({
      where: { isActive: true }
    });

    const ordersByStatus = await prisma.order.groupBy({
      by: ['status'],
      _count: true
    });

    res.json({
      success: true,
      data: {
        financial: {
          dailyIncome: Number(dailyIncome._sum.amount || 0),
          monthlyIncome: Number(monthlyIncome._sum.amount || 0),
          currentCash: Number(currentCash._sum.currentBalance || 0)
        },
        operational: {
          ordersReceivedToday,
          ordersPending,
          ordersInWarehouse,
          ordersDeliveredToday,
          totalActiveClients,
          ordersByStatus: ordersByStatus.reduce((acc, item) => {
            acc[item.status] = item._count;
            return acc;
          }, {} as Record<string, number>)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
