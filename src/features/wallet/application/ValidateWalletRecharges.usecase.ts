import { randomUUID } from 'crypto';
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { buildNotesJSON, cardTitleFromMethod, generateGroupId } from '../../../shared/utils/transactionNotes';

export interface ValidateWalletRechargesDTO {
    rechargeIds: string[];
}

export class ValidateWalletRechargesUseCase {
    constructor(
        private financialRepository: IFinancialRecordRepository
    ) { }

    async execute(dto: ValidateWalletRechargesDTO, validatedBy: string): Promise<Result<any>> {
        try {
            console.log(`[ValidateWalletRecharges] Validating ${dto.rechargeIds?.length} recharges by ${validatedBy}`);
            
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
                console.warn(`[ValidateWalletRecharges] No recharges found in PENDIENTE_VALIDACION for IDs: ${dto.rechargeIds}`);
                return Result.fail('No pending recharges found for the provided IDs. They might be already validated.');
            }

            // Using transaction to ensure atomic updates
            const results = await prisma.$transaction(async (tx) => {
                const updatedRecharges = [];

                for (let i = 0; i < recharges.length; i++) {
                    const recharge = recharges[i];
                    
                    let finalBankAccountId = recharge.bankAccountId;
                    
                    // AUTO-REPAIR: If it's EFECTIVO and missing bankAccountId, try to find a CASH account
                    if (recharge.paymentMethod === 'EFECTIVO' && !finalBankAccountId) {
                        const cashAccount = await tx.bankAccount.findFirst({
                            where: { type: 'CASH', isActive: true }
                        });
                        if (cashAccount) {
                            finalBankAccountId = cashAccount.id;
                            console.log(`[ValidateWalletRecharges] Auto-assigned CASH account ${cashAccount.name} to recharge ${recharge.id}`);
                        }
                    }

                    if (!finalBankAccountId) {
                        throw new Error(`La recarga ${recharge.id} (${recharge.paymentMethod}) no tiene una cuenta bancaria asociada y no se encontró una cuenta de CAJA automática.`);
                    }

                    // 1. Update recharge status
                    const updatedRecharge = await tx.walletRecharge.update({
                        where: { id: recharge.id },
                        data: {
                            status: 'VALIDADO',
                            bankAccountId: finalBankAccountId, // Ensure it's saved if auto-assigned
                            validatedByName: validatedBy,
                            validatedAt: new Date()
                        }
                    });

                    // 2. Ensure client account exists
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

                    // 3. Prepare snapshot data for balances
                    const walletSnap = await tx.clientAccount.findUnique({
                        where: { id: clientAccountId },
                        select: { totalCreditAvailable: true }
                    });
                    const walletBalanceBefore = walletSnap ? parseFloat(walletSnap.totalCreditAvailable.toString()) : 0;
                    const walletBalanceAfter = walletBalanceBefore + parseFloat(recharge.amount.toString());

                    const bankSnap = await tx.bankAccount.findUnique({
                        where: { id: finalBankAccountId },
                        select: { currentBalance: true }
                    });
                    const balanceBefore = bankSnap ? parseFloat(bankSnap.currentBalance.toString()) : 0;
                    const balanceAfter = balanceBefore + parseFloat(recharge.amount.toString());

                    const groupId = generateGroupId();
                    const baseRef = await this.financialRepository.generateReferenceNumber();
                    const generatedRef = `${baseRef}-${i}-${Math.random().toString(36).substring(7)}`;
                    const internalRef = `${generatedRef}-INT`;
                    
                    const clientFullName = recharge.client.firstName;
                    const methodLabel = recharge.paymentMethod === 'TRANSFERENCIA' ? 'Transferencia' :
                                       recharge.paymentMethod === 'DEPOSITO' ? 'Depósito' : 
                                       recharge.paymentMethod === 'CHEQUE' ? 'Cheque' : 'Pago';

                    // 4. Create Financial Records (Audit Trail)
                    // 4a. INCOME: External -> Bank Account
                    const incomeFR = await (tx as any).financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: generatedRef,
                            userReference: recharge.reference || null,
                            amount: recharge.amount,
                            date: new Date(),
                            clientId: recharge.clientId,
                            clientName: clientFullName,
                            clientDocument: recharge.client.identificationNumber,
                            createdBy: validatedBy,
                            notes: buildNotesJSON({
                                title: cardTitleFromMethod(recharge.paymentMethod),
                                module: 'WALLET',
                                clientDoc: recharge.client.identificationNumber || 'S/N',
                                orders: [],
                                description: recharge.notes || undefined,
                                extra: recharge.controlValidation ? `Control: ${recharge.controlValidation}` : undefined
                            }),
                            bankAccountId: finalBankAccountId,
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

                    // 4b. INTERNAL: Bank Account -> Wallet
                    await (tx as any).financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: internalRef,
                            userReference: recharge.reference || null,
                            amount: recharge.amount,
                            date: new Date(),
                            clientId: recharge.clientId,
                            clientName: clientFullName,
                            clientDocument: recharge.client.identificationNumber,
                            createdBy: validatedBy,
                            notes: buildNotesJSON({
                                title: 'RECARGA_BILLETERA',
                                module: 'WALLET',
                                clientDoc: recharge.client.identificationNumber || 'S/N',
                                orders: [],
                                description: recharge.notes || undefined,
                                extra: recharge.controlValidation ? `Control: ${recharge.controlValidation}` : undefined
                            }),
                            bankAccountId: finalBankAccountId,
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

                    // 5. Create core Credit record for usage tracking
                    await tx.clientCredit.create({
                        data: {
                            clientAccountId: clientAccountId!,
                            amount: recharge.amount,
                            remainingAmount: recharge.amount,
                            originTransactionId: incomeFR.id,
                            status: 'AVAILABLE'
                        }
                    });

                    // 6. UPDATE BALANCES (Actual money update)
                    // Wallet Update
                    await tx.clientAccount.update({
                        where: { id: clientAccountId },
                        data: {
                            totalCreditAvailable: { increment: recharge.amount },
                            version: { increment: 1 }
                        }
                    });

                    // Bank Account Update
                    await tx.bankAccount.update({
                        where: { id: finalBankAccountId },
                        data: {
                            currentBalance: { increment: recharge.amount },
                            version: { increment: 1 }
                        }
                    });

                    updatedRecharges.push(updatedRecharge);
                }

                return updatedRecharges;
            });

            console.log(`[ValidateWalletRecharges] Successfully validated ${results.length} recharges`);
            return Result.ok(results);

        } catch (error) {
            console.error('[ValidateWalletRecharges] Failed to validate recharges:', error);
            return Result.fail(error instanceof Error ? error.message : 'Unknown error during validation');
        }
    }
}
