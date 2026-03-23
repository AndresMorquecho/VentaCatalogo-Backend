import { Response } from 'express';
import { ProcessSplitPaymentUseCase } from '../application/ProcessSplitPayment.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';
import { AuthRequest } from '../../../middleware/auth';

export class SplitPaymentController {
  constructor(private processSplitPaymentUseCase: ProcessSplitPaymentUseCase) {}

  processSplitPayment = async (req: AuthRequest, res: Response) => {
    try {
      const { orders, payments, total, requestId } = req.body;
      const createdBy = req.user?.username || 'system';

      // Validaciones básicas del payload
      if (!orders || !Array.isArray(orders) || orders.length === 0) {
        return HttpResponse.badRequest(res, 'Missing required field: orders must be a non-empty array.');
      }

      if (!payments || !Array.isArray(payments) || payments.length === 0) {
        return HttpResponse.badRequest(res, 'Missing required field: payments must be a non-empty array.');
      }

      if (total === undefined || total === null || isNaN(Number(total))) {
        return HttpResponse.badRequest(res, 'Missing required field: total must be a valid number.');
      }

      if (!requestId || typeof requestId !== 'string') {
        return HttpResponse.badRequest(res, 'Missing required field: requestId must be a string.');
      }

      // Validar estructura de orders
      for (const order of orders) {
        if (!order.orderId || order.amount === undefined) {
          return HttpResponse.badRequest(res, 'Each order must have orderId and amount.');
        }
        if (Number(order.amount) <= 0) {
          return HttpResponse.badRequest(res, `Order amount must be positive. Got: ${order.amount}`);
        }
      }

      // Validar estructura de payments
      const validMethods = ['EFECTIVO', 'TRANSFERENCIA', 'BILLETERA_VIRTUAL'];
      for (const payment of payments) {
        if (!payment.method || !validMethods.includes(payment.method)) {
          return HttpResponse.badRequest(res, `Invalid payment method: ${payment.method}. Valid: ${validMethods.join(', ')}`);
        }
        if (payment.amount === undefined || Number(payment.amount) <= 0) {
          return HttpResponse.badRequest(res, `Payment amount must be positive. Got: ${payment.amount}`);
        }
        if (payment.method !== 'BILLETERA_VIRTUAL' && !payment.bankAccountId) {
          return HttpResponse.badRequest(res, `bankAccountId is required for method: ${payment.method}`);
        }
      }

      // Obtener clientId desde el primer pedido
      const firstOrder = await this.getOrderClientId(orders[0].orderId);
      if (!firstOrder) {
        return HttpResponse.badRequest(res, `Order not found: ${orders[0].orderId}`);
      }

      const result = await this.processSplitPaymentUseCase.execute({
        orders: orders.map(o => ({ orderId: o.orderId, amount: Number(o.amount) })),
        payments: payments.map(p => ({
          method: p.method,
          amount: Number(p.amount),
          bankAccountId: p.bankAccountId
        })),
        total: Number(total),
        requestId,
        clientId: firstOrder.clientId,
        createdBy
      });

      if (result.isFailure) {
        // Errores de validación de negocio
        const error = result.error;
        if (
          error?.includes('Insufficient wallet') ||
          error?.includes('does not match') ||
          error?.includes('not found') ||
          error?.includes('Negative amounts') ||
          error?.includes('already been completed') ||
          error?.includes('already being processed')
        ) {
          return HttpResponse.badRequest(res, error);
        }
        return HttpResponse.fail(res, error || 'Failed to process split payment');
      }

      return res.status(201).json({
        success: true,
        data: result.getValue()
      });

    } catch (error) {
      console.error('SplitPaymentController.processSplitPayment Error:', error);
      return HttpResponse.fail(
        res,
        error instanceof Error ? error.message : 'Error processing split payment'
      );
    }
  };

  private async getOrderClientId(orderId: string): Promise<{ clientId: string } | null> {
    const { prisma } = await import('../../../lib/prisma');
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { clientId: true }
    });
    return order;
  }
}
