import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { PrismaFinancialRecordRepository } from '../features/financial/infrastructure/PrismaFinancialRecordRepository';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const financialRepository = new PrismaFinancialRecordRepository();

router.post('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { orderId, amount, method, referenceNumber, notes, bankAccountId } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true }
    });

    if (!order) {
      throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
    }

    const result = await prisma.$transaction(async (tx) => {
      // Add payment to order
      const payment = await tx.orderPayment.create({
        data: {
          orderId,
          amount,
          method,
          reference: referenceNumber,
          description: notes || 'Abono posterior'
        }
      });

      // Create financial record using the repository
      await financialRepository.createOrderPaymentRecord(
        {
          orderId,
          clientId: order.clientId,
          clientName: order.clientName,
          amount,
          paymentMethod: method,
          bankAccountId,
          referenceNumber,
          notes
        },
        req.user!.email
      );

      // Get updated order
      const updatedOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: { payments: true }
      });

      return { payment, order: updatedOrder };
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const payments = await prisma.orderPayment.findMany({
      where: {
        orderId: req.query.orderId as string | undefined
      },
      include: { order: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: payments });
  } catch (error) {
    next(error);
  }
});

export default router;
