
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';

export interface CreateWalletRechargeDTO {
    clientId: string;
    amount: number;
    paymentMethod: string;
    bankAccountId?: string;
    reference?: string;
    notes?: string;
}

export class CreateWalletRechargeUseCase {
    constructor(
        private financialRepository: IFinancialRecordRepository
    ) { }

    async execute(dto: CreateWalletRechargeDTO, createdBy: string): Promise<Result<any>> {
        try {
            const client = await prisma.client.findUnique({
                where: { id: dto.clientId },
                include: { clientAccount: true }
            });

            if (!client) return Result.fail(`Client with ID ${dto.clientId} not found`);

            if (!client.clientAccount) {
                // Initialize client account if it doesn't exist
                await prisma.clientAccount.create({
                    data: {
                        clientId: client.id,
                        totalCreditAvailable: 0
                    }
                });
            }

            // All recharges start as PENDING, regardless of payment method
            const status = 'PENDIENTE_VALIDACION';

            // Validate duplicate reference for banked payments
            if (dto.paymentMethod !== 'EFECTIVO' && dto.reference) {
                const existing = await prisma.walletRecharge.findFirst({
                    where: { 
                        reference: dto.reference, 
                        paymentMethod: dto.paymentMethod,
                        status: { in: ['PENDIENTE_VALIDACION', 'VALIDADO'] }
                    }
                });
                if (existing) {
                    return Result.fail(`La referencia ${dto.reference} ya fue utilizada en una recarga previa.`);
                }
                
                // Also check financial records just in case
                const existingFin = await prisma.financialRecord.findFirst({
                    where: { referenceNumber: dto.reference }
                });
                if (existingFin) {
                    return Result.fail(`La referencia ${dto.reference} ya existe en los registros financieros.`);
                }
            }

            const result = await prisma.$transaction(async (tx) => {
                const recharge = await tx.walletRecharge.create({
                    data: {
                        clientId: dto.clientId,
                        amount: dto.amount,
                        paymentMethod: dto.paymentMethod,
                        bankAccountId: dto.bankAccountId,
                        reference: dto.reference,
                        notes: dto.notes,
                        status: status,
                        createdByName: createdBy,
                        validatedByName: null,
                        validatedAt: null
                    }
                });

                // Immediate processing removed as requested. 
                // All recharges must be validated in the /wallet-validations module.

                return recharge;
            });

            return Result.ok(result);

        } catch (error) {
            console.error('CreateWalletRechargeUseCase Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Failed to create wallet recharge');
        }
    }
}
