import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { PrismaFinancialRecordRepository } from '../features/financial/infrastructure/PrismaFinancialRecordRepository';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const financialRepository = new PrismaFinancialRecordRepository();

router.post('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { orderId, amount, method, referenceNumber, notes, bankAccountId, creditAmount } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true }
    });

    if (!order) {
      throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Handle regular payment (Cash, Transfer, etc.)
      let mainPayment = null;
      if (amount > 0) {
        if (!bankAccountId) {
          throw new AppError(400, 'Bank account is required for main payment', 'MISSING_BANK_ACCOUNT');
        }

        mainPayment = await tx.orderPayment.create({
          data: {
            orderId,
            amount,
            method,
            reference: referenceNumber,
            description: notes || 'Abono posterior'
          }
        });

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
          req.user!.username,
          tx
        );
      }

      // 2. Handle credit usage
      let creditPayment = null;
      if (creditAmount > 0) {
        // REDUCE CLIENT CREDITS
        const availableCredits = await tx.clientCredit.findMany({
          where: {
            clientAccount: { clientId: order.clientId },
            status: 'AVAILABLE'
          },
          orderBy: { createdAt: 'asc' }
        });

        let remainingToSubtract = creditAmount;
        for (const credit of availableCredits) {
          if (remainingToSubtract <= 0) break;
          const amountToSubtract = Math.min(Number(credit.remainingAmount), remainingToSubtract);

          await tx.clientCredit.update({
            where: { id: credit.id },
            data: {
              remainingAmount: { decrement: amountToSubtract },
              status: Number(credit.remainingAmount) - amountToSubtract <= 0.01 ? 'USED' : 'AVAILABLE'
            }
          });
          remainingToSubtract -= amountToSubtract;
        }

        if (remainingToSubtract > 0.01) {
          throw new AppError(400, `Saldo a favor insuficiente para cubrir $${creditAmount.toFixed(2)}`, 'INSUFFICIENT_CREDIT');
        }

        creditPayment = await tx.orderPayment.create({
          data: {
            orderId,
            amount: creditAmount,
            method: 'CREDITO_CLIENTE',
            description: 'Abono con saldo a favor'
          }
        });

        let finalCreditAccId = bankAccountId;
        if (!finalCreditAccId || finalCreditAccId === 'default') {
          const cashAcc = await tx.bankAccount.findFirst({ where: { type: 'CASH' } });
          if (cashAcc) finalCreditAccId = cashAcc.id;
        }

        await financialRepository.createOrderPaymentRecord(
          {
            orderId,
            clientId: order.clientId,
            clientName: order.clientName,
            amount: creditAmount,
            paymentMethod: 'CREDITO_CLIENTE',
            bankAccountId: finalCreditAccId!,
            referenceNumber: `REF-CRED-${Date.now()}`,
            notes: 'Abono con saldo a favor'
          },
          req.user!.username,
          tx
        );
      }

      // Get updated order
      const updatedOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: { payments: true }
      });

      return { payment: mainPayment || creditPayment, order: updatedOrder };
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
