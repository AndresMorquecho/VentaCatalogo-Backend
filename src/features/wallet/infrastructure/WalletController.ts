
import { Request, Response } from 'express';
import { CreateWalletRechargeUseCase } from '../application/CreateWalletRecharge.usecase';
import { ValidateWalletRechargesUseCase } from '../application/ValidateWalletRecharges.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';
import { AuthRequest } from '../../../middleware/auth';
import { prisma } from '../../../lib/prisma';

export class WalletController {
    constructor(
        private createUseCase: CreateWalletRechargeUseCase,
        private validateUseCase: ValidateWalletRechargesUseCase
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
}
