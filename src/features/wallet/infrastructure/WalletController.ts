
import { Request, Response } from 'express';
import { CreateWalletRechargeUseCase } from '../application/CreateWalletRecharge.usecase';
import { ValidateWalletRechargesUseCase } from '../application/ValidateWalletRecharges.usecase';
import { InstantWalletRechargeUseCase } from '../application/InstantWalletRecharge.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';
import { AuthRequest } from '../../../middleware/auth';
import { prisma } from '../../../lib/prisma';

export class WalletController {
    constructor(
        private createUseCase: CreateWalletRechargeUseCase,
        private validateUseCase: ValidateWalletRechargesUseCase,
        private instantRechargeUseCase?: InstantWalletRechargeUseCase
    ) { }

    async createRecharge(req: AuthRequest, res: Response) {
        try {
            console.log('[WalletController] Incoming body:', req.body);
            const body = req.body;
            const dto = {
                clientId: body.client_id || body.clientId,
                amount: Number(body.amount),
                paymentMethod: body.payment_method || body.paymentMethod,
                bankAccountId: body.bank_account_id || body.bankAccountId,
                reference: body.reference,
                notes: body.notes
            };

            console.log('[WalletController] Final DTO:', dto);
            
            if (!dto.clientId) {
                console.error('[WalletController] Missing clientId in body');
                return HttpResponse.badRequest(res, 'Client ID is required');
            }

            const createdBy = req.user?.username || 'system';
            const result = await this.createUseCase.execute(dto, createdBy);

            if (result.isFailure) {
                return HttpResponse.badRequest(res, result.error || 'Unknown error');
            }

            return HttpResponse.created(res, result.getValue());
        } catch (error: any) {
            return HttpResponse.fail(res, error || 'Internal Server Error');
        }
    }

    async validateRecharges(req: AuthRequest, res: Response) {
        try {
            const dto = {
                rechargeIds: req.body.recharge_ids || req.body.rechargeIds
            };
            const validatedBy = req.user?.username || 'system';
            const result = await this.validateUseCase.execute(dto, validatedBy);

            if (result.isFailure) {
                return HttpResponse.badRequest(res, result.error || 'Unknown error');
            }

            return HttpResponse.ok(res, result.getValue());
        } catch (error: any) {
            return HttpResponse.fail(res, error || 'Internal Server Error');
        }
    }

    async getPendingRecharges(req: AuthRequest, res: Response) {
        try {
            console.log('[WalletController] getPendingRecharges query:', req.query);
            const page = Math.max(1, parseInt(req.query.page as string) || 1);
            const limit = Math.max(1, parseInt(req.query.limit as string) || 15);
            const search = (req.query.search || req.query.searchText) as string;
            const skip = (page - 1) * limit;

            const where: any = { status: 'PENDIENTE_VALIDACION' };

            if (search) {
                where.OR = [
                    { reference: { contains: search, mode: 'insensitive' } },
                    { client: { firstName: { contains: search, mode: 'insensitive' } } },
                    { client: { identificationNumber: { contains: search, mode: 'insensitive' } } }
                ];
            }

            const [recharges, total] = await Promise.all([
                (prisma as any).walletRecharge.findMany({
                    where,
                    include: {
                        client: true,
                        bankAccount: true
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limit
                }),
                (prisma as any).walletRecharge.count({ where })
            ]);

            console.log(`[WalletController] getPendingRecharges found ${recharges.length} records of total ${total}`);

            return res.status(200).json({
                success: true,
                data: recharges,
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error: any) {
            return HttpResponse.fail(res, error || 'Internal Server Error');
        }
    }

    async getHistory(req: AuthRequest, res: Response) {
        try {
            console.log('[WalletController] getHistory query:', req.query);
            const page = Math.max(1, parseInt(req.query.page as string) || 1);
            const limit = Math.max(1, parseInt(req.query.limit as string) || 20);
            const search = (req.query.search || req.query.searchText) as string;
            const skip = (page - 1) * limit;

            const { client_id, clientId } = req.query;
            const targetId = (client_id || clientId) as string;
            
            const where: any = {};
            if (targetId) where.clientId = targetId;

            if (search) {
                const searchFilter = {
                    OR: [
                        { reference: { contains: search, mode: 'insensitive' } },
                        { client: { firstName: { contains: search, mode: 'insensitive' } } },
                        { client: { identificationNumber: { contains: search, mode: 'insensitive' } } }
                    ]
                };
                
                if (where.clientId) {
                    where.AND = [searchFilter];
                } else {
                    Object.assign(where, searchFilter);
                }
            }

            const [recharges, total] = await Promise.all([
                (prisma as any).walletRecharge.findMany({
                    where,
                    include: {
                        client: true,
                        bankAccount: true
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limit
                }),
                (prisma as any).walletRecharge.count({ where })
            ]);

            return res.status(200).json({
                success: true,
                data: recharges,
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error: any) {
            return HttpResponse.fail(res, error || 'Internal Server Error');
        }
    }

    async rejectRecharge(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const validatedBy = req.user?.username || 'system';

            const recharge = await (prisma as any).walletRecharge.update({
                where: { id },
                data: {
                    status: 'RECHAZADO',
                    rejectionReason: reason,
                    validatedByName: validatedBy,
                    validatedAt: new Date()
                }
            });

            return HttpResponse.ok(res, recharge);
        } catch (error: any) {
            return HttpResponse.fail(res, error || 'Internal Server Error');
        }
    }

    async instantRecharge(req: AuthRequest, res: Response) {
        try {
            const body = req.body;
            // Reuse the standard create flow — recharge goes to PENDIENTE_VALIDACION
            // and must be validated in /wallet-validations before credit is applied.
            const dto = {
                clientId: body.clientId || body.client_id,
                amount: Number(body.amount),
                paymentMethod: body.paymentMethod || body.payment_method,
                bankAccountId: body.bankAccountId || body.bank_account_id,
                reference: body.reference,
                notes: body.notes
            };
            const createdBy = req.user?.username || 'system';
            const result = await this.createUseCase.execute(dto, createdBy);
            if (result.isFailure) {
                return HttpResponse.badRequest(res, result.error || 'Unknown error');
            }
            return HttpResponse.created(res, result.getValue());
        } catch (error: any) {
            return HttpResponse.fail(res, error?.message || 'Internal Server Error');
        }
    }

    /**
     * Get detailed wallet transaction history for a client
     * Shows all credit movements (generation and application)
     */
    async getClientWalletHistory(req: AuthRequest, res: Response) {
        try {
            const { clientId } = req.params;
            
            if (!clientId) {
                return HttpResponse.badRequest(res, 'Client ID is required');
            }

            // Get client account
            const clientAccount = await prisma.clientAccount.findUnique({
                where: { clientId },
                select: {
                    id: true,
                    totalCreditAvailable: true
                }
            });

            if (!clientAccount) {
                return HttpResponse.ok(res, {
                    history: [],
                    currentBalance: 0
                });
            }

            // Get all ClientCredit records (source of truth for wallet balance)
            const credits = await prisma.clientCredit.findMany({
                where: {
                    clientAccountId: clientAccount.id
                },
                orderBy: {
                    createdAt: 'asc'
                }
            });

            // Get all payments using CREDITO_CLIENTE method for this client
            const creditPayments = await prisma.orderPayment.findMany({
                where: {
                    method: 'CREDITO_CLIENTE',
                    order: {
                        clientId: clientId
                    }
                },
                include: {
                    order: {
                        select: {
                            id: true,
                            receiptNumber: true,
                            orderNumber: true,
                            brand: {
                                select: {
                                    name: true
                                }
                            }
                        }
                    }
                },
                orderBy: {
                    createdAt: 'asc'
                }
            });

            // Build unified history
            const history: any[] = [];

            // Add credit generations (AVAILABLE or USED)
            for (const credit of credits) {
                // Get origin order info
                let originOrder = null;
                if (credit.originOrderId) {
                    originOrder = await prisma.order.findUnique({
                        where: { id: credit.originOrderId },
                        select: {
                            receiptNumber: true,
                            orderNumber: true,
                            brand: {
                                select: {
                                    name: true
                                }
                            }
                        }
                    });
                }

                // Determine who created it from the transaction ID or financial records
                let createdBy = 'system';
                const financialRecord = await prisma.financialRecord.findFirst({
                    where: {
                        OR: [
                            {
                                type: 'CREDIT_GENERATION',
                                orderId: credit.originOrderId
                            },
                            {
                                referenceNumber: {
                                    contains: credit.originTransactionId
                                }
                            }
                        ]
                    },
                    select: {
                        createdBy: true
                    }
                });
                if (financialRecord) {
                    createdBy = financialRecord.createdBy;
                }

                history.push({
                    id: `gen-${credit.id}`,
                    type: 'CREDIT_GENERATION',
                    movementType: 'INCOME',
                    amount: Number(credit.amount),
                    date: credit.createdAt,
                    createdBy: createdBy,
                    notes: `Saldo a favor generado${originOrder ? ` - Origen: Pedido ${originOrder.receiptNumber}` : ''}`,
                    orderId: credit.originOrderId,
                    orderReceiptNumber: originOrder?.receiptNumber || null,
                    orderNumber: originOrder?.orderNumber || null,
                    brandName: originOrder?.brand?.name || null,
                    status: credit.status,
                    creditId: credit.id
                });
            }

            // Add credit applications (uses) - only count the actual amount used
            for (const payment of creditPayments) {
                // Get who created the payment
                let createdBy = 'system';
                const financialRecord = await prisma.financialRecord.findFirst({
                    where: {
                        orderPaymentId: payment.id
                    },
                    select: {
                        createdBy: true
                    }
                });
                if (financialRecord) {
                    createdBy = financialRecord.createdBy;
                }

                history.push({
                    id: `app-${payment.id}`,
                    type: 'CREDIT_APPLICATION',
                    movementType: 'EXPENSE',
                    amount: Number(payment.amount),
                    date: payment.createdAt,
                    createdBy: createdBy,
                    notes: `Saldo aplicado a pedido ${payment.order.receiptNumber}`,
                    orderId: payment.order.id,
                    orderReceiptNumber: payment.order.receiptNumber,
                    orderNumber: payment.order.orderNumber,
                    brandName: payment.order.brand?.name || null,
                    status: 'USED',
                    paymentId: payment.id
                });
            }

            // Sort by date
            history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            // Calculate running balance
            let runningBalance = 0;
            const historyWithBalance = history.map(record => {
                if (record.type === 'CREDIT_GENERATION') {
                    runningBalance += record.amount;
                } else if (record.type === 'CREDIT_APPLICATION') {
                    runningBalance -= record.amount;
                }

                return {
                    ...record,
                    balance: runningBalance
                };
            });

            // Verify balance matches
            const calculatedBalance = runningBalance;
            
            // Calculate REAL available balance from AVAILABLE credits
            const availableCredits = credits.filter(c => c.status === 'AVAILABLE');
            const realAvailableBalance = availableCredits.reduce((sum, c) => sum + Number(c.remainingAmount), 0);
            
            const accountBalance = Number(clientAccount.totalCreditAvailable);
            const difference = Math.abs(realAvailableBalance - accountBalance);

            // If there's a significant difference, log it for debugging
            if (difference > 0.01) {
                console.warn(`[WalletHistory] Balance mismatch for client ${clientId}:`);
                console.warn(`  Calculated from history: $${calculatedBalance.toFixed(2)}`);
                console.warn(`  Real available (from AVAILABLE credits): $${realAvailableBalance.toFixed(2)}`);
                console.warn(`  ClientAccount.totalCreditAvailable: $${accountBalance.toFixed(2)}`);
                console.warn(`  Difference: $${difference.toFixed(2)}`);
                console.warn(`  Total credits: ${credits.length}`);
                console.warn(`  Available credits: ${availableCredits.length}`);
                console.warn(`  Total payments: ${creditPayments.length}`);
            }

            return HttpResponse.ok(res, {
                history: historyWithBalance,
                currentBalance: realAvailableBalance, // Use REAL balance from AVAILABLE credits
                accountBalance: accountBalance, // For debugging
                calculatedBalance: calculatedBalance,
                difference: difference
            });
        } catch (error: any) {
            console.error('[WalletController] getClientWalletHistory error:', error);
            return HttpResponse.fail(res, error?.message || 'Internal Server Error');
        }
    }
}
