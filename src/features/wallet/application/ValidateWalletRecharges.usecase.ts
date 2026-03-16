
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';

export interface ValidateWalletRechargesDTO {
    rechargeIds: string[];
}

export class ValidateWalletRechargesUseCase {
    constructor(
        private financialRepository: IFinancialRecordRepository
    ) { }

    async execute(dto: ValidateWalletRechargesDTO, validatedBy: string): Promise<Result<any>> {
        try {
            if (!dto.rechargeIds || dto.rechargeIds.length === 0) {
                return Result.fail('No recharge IDs provided');
            }

            const recharges = await prisma.walletRecharge.findMany({
                where: {
                    id: { in: dto.rechargeIds },
                    status: 'PENDIENTE_VALIDACION'
                },
                include: {
                    client: {
                        include: { clientAccount: true }
                    }
                }
            });

            if (recharges.length === 0) {
                return Result.fail('No pending recharges found for the provided IDs');
            }

            const result = await prisma.$transaction(async (tx) => {
                const results = [];

                for (const recharge of recharges) {
                    // 1. Update status
                    const updatedRecharge = await tx.walletRecharge.update({
                        where: { id: recharge.id },
                        data: {
                            status: 'VALIDADO',
                            validatedByName: validatedBy,
                            validatedAt: new Date()
                        }
                    });

                    // Ensure client account exists
                    let clientAccountId = recharge.client.clientAccount?.id;
                    if (!clientAccountId) {
                        const newAccount = await tx.clientAccount.create({
                            data: {
                                clientId: recharge.clientId,
                                totalCreditAvailable: 0
                            }
                        });
                        clientAccountId = newAccount.id;
                    }

                    // 2. Create ClientCredit
                    await tx.clientCredit.create({
                        data: {
                            clientAccountId: clientAccountId,
                            amount: recharge.amount,
                            remainingAmount: recharge.amount,
                            originTransactionId: recharge.id,
                            status: 'AVAILABLE'
                        }
                    });

                    // 3. Update ClientAccount
                    await tx.clientAccount.update({
                        where: { id: clientAccountId },
                        data: {
                            totalCreditAvailable: { increment: recharge.amount },
                            version: { increment: 1 }
                        }
                    });

                    // 4. Create FinancialRecord
                    const finRef = recharge.reference || await this.financialRepository.generateReferenceNumber();
                    await tx.financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: `REC-${recharge.id.substring(0, 5)}-${recharge.reference || 'EFECT'}`,
                            amount: recharge.amount,
                            date: new Date(),
                            clientId: recharge.clientId,
                            clientName: recharge.client.firstName,
                            createdBy: validatedBy,
                            notes: recharge.notes || `Recarga de billetera validada (${recharge.paymentMethod})`,
                            bankAccountId: recharge.bankAccountId!,
                            source: 'MANUAL',
                            paymentMethod: recharge.paymentMethod,
                            movementType: 'INCOME',
                            version: 1
                        }
                    });

                    // 5. Update BankAccount balance
                    if (recharge.bankAccountId) {
                        await tx.bankAccount.update({
                            where: { id: recharge.bankAccountId },
                            data: {
                                currentBalance: { increment: recharge.amount },
                                version: { increment: 1 }
                            }
                        });
                    }

                    results.push(updatedRecharge);
                }

                return results;
            });

            return Result.ok(result);

        } catch (error) {
            console.error('ValidateWalletRechargesUseCase Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Failed to validate wallet recharges');
        }
    }
}
