
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

                    // Read wallet balance BEFORE update for snapshot
                    const walletSnap = await tx.clientAccount.findUnique({
                        where: { id: clientAccountId },
                        select: { totalCreditAvailable: true }
                    });
                    const walletBalanceBefore = walletSnap ? parseFloat(walletSnap.totalCreditAvailable.toString()) : 0;
                    const walletBalanceAfter = walletBalanceBefore + parseFloat(recharge.amount.toString());

                    // 2. Create FinancialRecords FIRST — two entries per recharge:
                    //    a) INCOME: EXTERNAL → BANK_ACCOUNT (real money entering the system)
                    //    b) INTERNAL: BANK_ACCOUNT → WALLET (internal transfer to client wallet)
                    const groupId = crypto.randomUUID();
                    const generatedRef = await this.financialRepository.generateReferenceNumber();
                    const internalRef = `${generatedRef}-INT`;

                    // Read current bank balance for snapshot BEFORE the update
                    const bankSnap = recharge.bankAccountId
                        ? await tx.bankAccount.findUnique({
                            where: { id: recharge.bankAccountId },
                            select: { currentBalance: true }
                        })
                        : null;
                    const balanceBefore = bankSnap ? parseFloat(bankSnap.currentBalance.toString()) : 0;
                    const balanceAfter = balanceBefore + parseFloat(recharge.amount.toString());

                    // 2a. Real income: client pays into bank account
                    const incomeFR = await (tx as any).financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: generatedRef,
                            userReference: recharge.reference || null,
                            amount: recharge.amount,
                            date: new Date(),
                            clientId: recharge.clientId,
                            clientName: recharge.client.firstName,
                            clientDocument: recharge.client.identificationNumber,
                            createdBy: validatedBy,
                            notes: `Transferencia recibida | Recarga billetera (${recharge.paymentMethod}) | Comprobante: ${recharge.reference || 'N/A'}`,
                            bankAccountId: recharge.bankAccountId!,
                            source: 'MANUAL',
                            paymentMethod: recharge.paymentMethod,
                            movementType: 'INCOME',
                            fromAccountType: 'EXTERNAL',
                            toAccountType: 'BANK_ACCOUNT',
                            transactionGroupId: groupId,
                            balanceBefore,
                            balanceAfter,
                            version: 1
                        }
                    });

                    // 2b. Internal transfer: bank account → client wallet
                    await (tx as any).financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: internalRef,
                            userReference: recharge.reference || null,
                            amount: recharge.amount,
                            date: new Date(),
                            clientId: recharge.clientId,
                            clientName: recharge.client.firstName,
                            clientDocument: recharge.client.identificationNumber,
                            createdBy: validatedBy,
                            notes: `Recarga a billetera virtual | Comprobante: ${recharge.reference || 'N/A'}`,
                            bankAccountId: recharge.bankAccountId!,
                            source: 'MANUAL',
                            paymentMethod: recharge.paymentMethod,
                            movementType: 'INTERNAL',
                            fromAccountType: 'BANK_ACCOUNT',
                            toAccountType: 'WALLET',
                            transactionGroupId: groupId,
                            balanceBefore: walletBalanceBefore,
                            balanceAfter: walletBalanceAfter,
                            version: 1
                        }
                    });

                    // 3. Create ClientCredit with CORRECT originTransactionId (INCOME FR)
                    await tx.clientCredit.create({
                        data: {
                            clientAccountId: clientAccountId,
                            amount: recharge.amount,
                            remainingAmount: recharge.amount,
                            originTransactionId: incomeFR.id,
                            status: 'AVAILABLE'
                        }
                    });

                    // 4. Update ClientAccount
                    await tx.clientAccount.update({
                        where: { id: clientAccountId },
                        data: {
                            totalCreditAvailable: { increment: recharge.amount },
                            version: { increment: 1 }
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
