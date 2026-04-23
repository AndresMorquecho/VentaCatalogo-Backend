
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
                controlValidation: body.control_validation || body.controlValidation,
                notes: body.notes,
                transactionDate: body.transaction_date || body.transactionDate || body.date
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

            const { client_id, clientId, status, isDismissed } = req.query;
            const targetId = (client_id || clientId) as string;
            
            const where: any = {};
            if (targetId) where.clientId = targetId;
            if (status) where.status = status;
            if (isDismissed === 'false') where.isDismissed = false;
            if (isDismissed === 'true') where.isDismissed = true;

            if (search) {
                const searchFilter = {
                    OR: [
                        { reference: { contains: search, mode: 'insensitive' } },
                        { client: { firstName: { contains: search, mode: 'insensitive' } } },
                        { client: { identificationNumber: { contains: search, mode: 'insensitive' } } }
                    ]
                };
                
                if (Object.keys(where).length > 0) {
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

    async dismissRecharge(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;

            const recharge = await (prisma as any).walletRecharge.update({
                where: { id },
                data: {
                    isDismissed: true
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
            const dto = {
                clientId: body.clientId || body.client_id,
                amount: Number(body.amount),
                paymentMethod: body.paymentMethod || body.payment_method,
                bankAccountId: body.bankAccountId || body.bank_account_id,
                reference: body.reference || body.reference,
                controlValidation: body.controlValidation || body.control_validation,
                notes: body.notes,
                transactionDate: body.transaction_date || body.transactionDate || body.date
            };
            const createdBy = req.user?.username || 'system';

            // Check if we have the instant use case available
            if (this.instantRechargeUseCase) {
                console.log(`[WalletController] Using InstantWalletRechargeUseCase for ${dto.paymentMethod}`);
                const result = await this.instantRechargeUseCase.execute(dto, createdBy);
                if (result.isFailure) {
                    return HttpResponse.badRequest(res, result.error || 'Unknown error');
                }
                return HttpResponse.created(res, result.getValue());
            }

            // Fallback (should not happen if DI is correct)
            console.warn('[WalletController] InstantWalletRechargeUseCase not provided, falling back to create');
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

            // Get all financial records that involve the wallet (as source or destination)
            const walletRecords = await prisma.financialRecord.findMany({
                where: {
                    clientId,
                    OR: [
                        { fromAccountType: 'WALLET' },
                        { toAccountType: 'WALLET' }
                    ]
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
                    date: 'asc'
                }
            });

            // Build unified history from financial records
            let runningBalance = 0;
            const history = walletRecords.map(record => {
                const isIncome = record.toAccountType === 'WALLET';
                const amount = Number(record.amount);
                
                if (isIncome) {
                    runningBalance += amount;
                } else {
                    runningBalance -= amount;
                }

                // Parse notes if JSON, or use as prefix
                let displayNotes = record.notes || '';
                try {
                    const notesObj = JSON.parse(record.notes || '{}');
                    if (notesObj.description) {
                        displayNotes = notesObj.description;
                    } else if (notesObj.title) {
                        displayNotes = notesObj.title;
                    }
                } catch (e) {
                    // Not JSON, use as is
                }

                return {
                    id: record.id,
                    type: record.type,
                    movementType: isIncome ? 'INCOME' : 'EXPENSE',
                    amount: amount,
                    date: record.date,
                    createdBy: record.createdBy,
                    notes: displayNotes,
                    orderId: record.orderId,
                    orderReceiptNumber: record.order?.receiptNumber || null,
                    orderNumber: record.order?.orderNumber || null,
                    brandName: record.order?.brand?.name || null,
                    status: 'COMPLETADO',
                    balance: runningBalance
                };
            });

            // Calculate current balance (from AVAILABLE credits for validation)
            const availableCredits = await prisma.clientCredit.findMany({
                where: {
                    clientAccount: { clientId },
                    status: 'AVAILABLE'
                }
            });
            const realAvailableBalance = availableCredits.reduce((sum, c) => sum + Number(c.remainingAmount), 0);
            
            const accountBalance = Number(clientAccount.totalCreditAvailable);
            const difference = Math.abs(realAvailableBalance - accountBalance);

            // If there's a significant difference, log it for debugging
            if (difference > 0.01) {
                console.warn(`[WalletHistory] Balance mismatch for client ${clientId}:`);
                console.warn(`  Calculated from history: $${runningBalance.toFixed(2)}`);
                console.warn(`  Real available (credits): $${realAvailableBalance.toFixed(2)}`);
                console.warn(`  ClientAccount (aggregate): $${accountBalance.toFixed(2)}`);
            }

            return HttpResponse.ok(res, {
                history: history.reverse(), // Show newest first
                currentBalance: accountBalance,
                calculatedBalance: runningBalance,
                difference: difference
            });

        } catch (error: any) {
            console.error('[WalletController] getClientWalletHistory error:', error);
            return HttpResponse.fail(res, error?.message || 'Internal Server Error');
        }
    }
}
