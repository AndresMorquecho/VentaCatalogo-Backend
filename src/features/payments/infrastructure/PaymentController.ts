
import { Request, Response } from 'express';
import { RegisterOrderPaymentUseCase } from '../application/RegisterOrderPayment.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';
import { AuthRequest } from '../../../middleware/auth';
import { prisma } from '../../../lib/prisma';

export class PaymentController {
    constructor(private registerOrderPaymentUseCase: RegisterOrderPaymentUseCase) { }

    registerPayment = async (req: AuthRequest, res: Response) => {
        try {
            const orderId = req.body.orderId || req.body.order_id;
            const amount = req.body.amount;
            const creditAmount = req.body.creditAmount ?? req.body.credit_amount;
            const method = req.body.method || req.body.payment_method;
            const referenceNumber = req.body.referenceNumber || req.body.reference_number;
            const bankAccountId = req.body.bankAccountId || req.body.bank_account_id;
            const notes = req.body.notes;


            if (!orderId) {
                return HttpResponse.badRequest(res, 'Missing required field: orderId is required.');
            }

            const parsedAmount = Number(amount || 0);
            const parsedCreditAmount = Number(creditAmount || 0);

            if (parsedAmount <= 0 && parsedCreditAmount <= 0) {
                return HttpResponse.badRequest(res, 'At least one of amount or creditAmount must be greater than zero.');
            }

            if (parsedAmount > 0 && (!method || !bankAccountId)) {
                return HttpResponse.badRequest(res, 'Missing required fields: method and bankAccountId are required for manual payments.');
            }

            const dto = {
                orderId,
                amount: parsedAmount,
                method: method || 'EFECTIVO',
                referenceNumber,
                bankAccountId,
                notes,
                creditAmount: parsedCreditAmount
            };

            const result = await this.registerOrderPaymentUseCase.execute(dto, req.user!.username);

            if (result.isFailure) {
                return HttpResponse.fail(res, result.error!);
            }

            return HttpResponse.created(res, result.getValue());
        } catch (error) {
            return HttpResponse.fail(res, error instanceof Error ? error.message : 'An unexpected error occurred during payment registration.');
        }
    };

    updatePayment = async (req: AuthRequest, res: Response) => {
        try {
            const { paymentId } = req.params as any;
            const amount = req.body.amount !== undefined ? Number(req.body.amount) : undefined;
            const reference = req.body.reference ?? req.body.referenceNumber ?? req.body.reference_number;
            const description = req.body.description ?? req.body.notes;

            const payment = await prisma.orderPayment.findUnique({
                where: { id: paymentId },
                include: { order: true }
            });
            if (!payment) return HttpResponse.notFound(res, 'Payment not found');

            if (payment.method === 'CREDITO_CLIENTE') {
                return HttpResponse.badRequest(res, 'No se permite editar abonos de tipo CREDITO_CLIENTE desde este endpoint.');
            }

            const lastClosure = await prisma.cashClosure.findFirst({ orderBy: { toDate: 'desc' } });
            if (lastClosure && payment.createdAt <= lastClosure.toDate) {
                return HttpResponse.badRequest(res, 'No se puede editar: El periodo de caja ya está cerrado.');
            }

            const result = await prisma.$transaction(async (tx) => {
                const fr = await tx.financialRecord.findFirst({
                    where: { orderPaymentId: payment.id, type: 'PAYMENT' }
                });

                const oldAmount = Number(payment.amount);
                const newAmount = amount !== undefined ? Number(amount) : oldAmount;
                const diff = newAmount - oldAmount;

                const updatedPayment = await tx.orderPayment.update({
                    where: { id: payment.id },
                    data: {
                        amount: newAmount,
                        reference: reference !== undefined ? String(reference) : undefined,
                        description: description !== undefined ? String(description) : undefined,
                    }
                });

                if (fr) {
                    await tx.financialRecord.update({
                        where: { id: fr.id },
                        data: {
                            amount: newAmount,
                            referenceNumber: fr.referenceNumber, // immutable unique
                            notes: description !== undefined ? String(description) : fr.notes,
                            version: { increment: 1 }
                        }
                    });
                }

                if (payment.order.bankAccountId && Math.abs(diff) > 0.0001) {
                    await tx.bankAccount.update({
                        where: { id: payment.order.bankAccountId },
                        data: { currentBalance: { increment: diff }, version: { increment: 1 } }
                    });
                }

                return updatedPayment;
            });

            return HttpResponse.ok(res, result);
        } catch (error) {
            return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to update payment');
        }
    };

    deletePayment = async (req: AuthRequest, res: Response) => {
        try {
            const { paymentId } = req.params as any;

            const payment = await prisma.orderPayment.findUnique({
                where: { id: paymentId },
                include: { order: true }
            });
            if (!payment) return HttpResponse.notFound(res, 'Payment not found');

            if (payment.method === 'CREDITO_CLIENTE') {
                return HttpResponse.badRequest(res, 'No se permite eliminar abonos de tipo CREDITO_CLIENTE desde este endpoint.');
            }

            const lastClosure = await prisma.cashClosure.findFirst({ orderBy: { toDate: 'desc' } });
            if (lastClosure && payment.createdAt <= lastClosure.toDate) {
                return HttpResponse.badRequest(res, 'No se puede eliminar: El periodo de caja ya está cerrado.');
            }

            await prisma.$transaction(async (tx) => {
                const fr = await tx.financialRecord.findFirst({
                    where: { orderPaymentId: payment.id, type: 'PAYMENT' }
                });

                const amount = Number(payment.amount);

                if (payment.order.bankAccountId && amount > 0) {
                    await tx.bankAccount.update({
                        where: { id: payment.order.bankAccountId },
                        data: { currentBalance: { decrement: amount }, version: { increment: 1 } }
                    });
                }

                if (fr) {
                    await tx.financialRecord.delete({ where: { id: fr.id } });
                }

                await tx.orderPayment.delete({ where: { id: payment.id } });
            });

            return HttpResponse.ok(res, { message: 'Payment deleted' });
        } catch (error) {
            return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to delete payment');
        }
    };
}
