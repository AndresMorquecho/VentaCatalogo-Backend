
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
            const payments = req.body.payments; // Array de métodos de pago
            
            // Soporte para formato legacy (un solo pago)
            if (!payments && req.body.amount) {
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
            }

            // Nuevo formato: múltiples métodos de pago
            if (!orderId) {
                return HttpResponse.badRequest(res, 'Missing required field: orderId is required.');
            }

            if (!payments || !Array.isArray(payments) || payments.length === 0) {
                return HttpResponse.badRequest(res, 'Missing required field: payments array is required.');
            }

            // Procesar todos los métodos de pago en una sola transacción atómica
            const processResults = await prisma.$transaction(async (tx) => {
                const innerResults = [];

                for (const payment of payments) {
                    const amount = Number(payment.amount || 0);
                    const method = payment.method;
                    const referenceNumber = payment.transactionReference || payment.transaction_reference;
                    const bankAccountId = payment.bankAccountId || payment.bank_account_id;
                    const notes = payment.notes;

                    if (amount <= 0) {
                        throw new Error('Cada pago debe tener un monto mayor a cero.');
                    }

                    if (!method) {
                        throw new Error('Cada pago debe tener un método definido.');
                    }

                    if (method === 'BILLETERA_VIRTUAL') {
                        const dto = {
                            orderId,
                            amount: 0,
                            method: 'BILLETERA_VIRTUAL',
                            referenceNumber: undefined,
                            bankAccountId: 'default',
                            notes: notes || 'Pago con billetera virtual',
                            creditAmount: amount
                        };

                        const result = await this.registerOrderPaymentUseCase.execute(dto, req.user!.username, tx);
                        if (result.isFailure) {
                            throw new Error(result.error || 'Error procesando pago con billetera');
                        }
                        innerResults.push(result.getValue());
                    } else {
                        // Pago manual (Efectivo/Banco)
                        if (!bankAccountId) {
                            throw new Error('Se requiere una cuenta de destino para pagos manuales.');
                        }

                        const dto = {
                            orderId,
                            amount,
                            method,
                            referenceNumber,
                            bankAccountId,
                            notes,
                            creditAmount: 0
                        };

                        const result = await this.registerOrderPaymentUseCase.execute(dto, req.user!.username, tx);
                        if (result.isFailure) {
                            throw new Error(result.error || 'Error procesando pago manual');
                        }
                        innerResults.push(result.getValue());
                    }
                }
                return innerResults;
            }, {
                maxWait: 15000,
                timeout: 30000
            });

            return HttpResponse.created(res, { 
                payments: processResults, 
                message: `${processResults.length} pago(s) registrado(s) correctamente` 
            });
        } catch (error) {
            console.error('[PaymentController] Error:', error);
            return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error inesperado durante el registro del pago.');
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
            if (!payment) return HttpResponse.notFound(res, 'Abono no encontrado');



            // REGLA: Solo se puede eliminar el ÚLTIMO abono registrado del pedido para no desconfigurar saldos históricos
            const lastPayment = await prisma.orderPayment.findFirst({
                where: { orderId: payment.orderId },
                orderBy: { createdAt: 'desc' }
            });

            if (lastPayment && lastPayment.id !== payment.id) {
                return HttpResponse.badRequest(res, 'Solo se puede eliminar el último abono registrado para este pedido.');
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

                if (payment.method === 'CREDITO_CLIENTE') {
                    const clientAccount = await tx.clientAccount.findUnique({
                        where: { clientId: payment.order.clientId }
                    });
                    
                    if (clientAccount) {
                        await tx.clientAccount.update({
                            where: { id: clientAccount.id },
                            data: {
                                totalCreditAvailable: { increment: amount },
                                version: { increment: 1 }
                            }
                        });

                        await tx.clientCredit.create({
                            data: {
                                clientAccountId: clientAccount.id,
                                amount: amount,
                                remainingAmount: amount,
                                originTransactionId: `REV-${payment.id.substring(0, 10)}`,
                                originOrderId: payment.order.id,
                                status: 'AVAILABLE'
                            }
                        });
                    }
                } else {
                    // REVERSIÓN DE BANCO/CAJA
                    // Usamos el bankAccountId del registro financiero (donde entró el dinero realmente)
                    if (fr && fr.bankAccountId && amount > 0) {
                        await tx.bankAccount.update({
                            where: { id: fr.bankAccountId },
                            data: { currentBalance: { decrement: amount }, version: { increment: 1 } }
                        });
                    }
                }

                if (fr) {
                    await tx.financialRecord.delete({ where: { id: fr.id } });
                }

                await tx.orderPayment.delete({ where: { id: payment.id } });
                
                // Actualizar timestamp del pedido para invalidar caches si es necesario
                await tx.order.update({
                    where: { id: payment.orderId },
                    data: { updatedAt: new Date() }
                });
            });

            return HttpResponse.ok(res, { message: 'Abono eliminado correctamente y saldo revertido.' });
        } catch (error) {
            console.error('[PaymentController.deletePayment] Error:', error);
            return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error al eliminar el abono');
        }
    };
}
