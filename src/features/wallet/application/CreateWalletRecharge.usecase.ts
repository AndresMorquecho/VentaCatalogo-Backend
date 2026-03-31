
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

            // For EFECTIVO, if no bankAccountId is provided, try to find a CASH account
            let finalBankAccountId = dto.bankAccountId;
            if (dto.paymentMethod === 'EFECTIVO' && !finalBankAccountId) {
                const cashAccount = await prisma.bankAccount.findFirst({
                    where: { type: 'CASH', isActive: true }
                });
                if (cashAccount) {
                    finalBankAccountId = cashAccount.id;
                }
            }

            if (dto.paymentMethod === 'EFECTIVO' && !finalBankAccountId) {
                return Result.fail('No se encontró una cuenta de CAJA activa para registrar el ingreso en efectivo.');
            }

            if (!client.clientAccount) {
                // Initialize client account if it doesn't exist
                await prisma.clientAccount.create({
                    data: {
                        clientId: client.id,
                        totalCreditAvailable: 0
                    }
                });
            }

            const result = await prisma.$transaction(async (tx) => {
                const recharge = await tx.walletRecharge.create({
                    data: {
                        clientId: dto.clientId,
                        amount: dto.amount,
                        paymentMethod: dto.paymentMethod,
                        bankAccountId: finalBankAccountId,
                        reference: dto.reference,
                        notes: dto.notes,
                        status: dto.paymentMethod === 'EFECTIVO' ? 'VALIDADO' : 'PENDIENTE_VALIDACION',
                        createdByName: createdBy,
                        validatedByName: dto.paymentMethod === 'EFECTIVO' ? createdBy : null,
                        validatedAt: dto.paymentMethod === 'EFECTIVO' ? new Date() : null
                    }
                });

                // If it's CASH (EFECTIVO), we process it immediately (no validation needed from bank)
                if (dto.paymentMethod === 'EFECTIVO') {
                    const clientData = client as any;
                    const clientName = clientData.lastName ? `${clientData.firstName} ${clientData.lastName}` : clientData.firstName;
                    const refNumber = dto.reference || await this.financialRepository.generateReferenceNumber();
                    const groupId = crypto.randomUUID();
                    const internalRef = `REC-${recharge.id.substring(0, 8)}-${refNumber}-INT`;

                    // Ensure client account exists (already checked above but for TS)
                    let clientAccountId = client.clientAccount?.id;
                    if (!clientAccountId) {
                        const newAccount = await tx.clientAccount.create({
                            data: { clientId: dto.clientId, totalCreditAvailable: 0 }
                        });
                        clientAccountId = newAccount.id;
                    }

                    // Snapshots for balance tracking
                    const bankSnap = finalBankAccountId ? await tx.bankAccount.findUnique({ where: { id: finalBankAccountId }, select: { currentBalance: true } }) : null;
                    const balanceBefore = bankSnap ? parseFloat(bankSnap.currentBalance.toString()) : 0;
                    const balanceAfter = balanceBefore + dto.amount;

                    const walletBalanceBefore = parseFloat(client.clientAccount?.totalCreditAvailable?.toString() || "0");
                    const walletBalanceAfter = walletBalanceBefore + dto.amount;

                    // 1. INCOME: Money enters cash account
                    const incomeFR = await tx.financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: `REC-${recharge.id.substring(0, 8)}-${refNumber}`,
                            userReference: dto.reference || null,
                            amount: dto.amount,
                            date: new Date(),
                            clientId: dto.clientId,
                            clientName,
                            clientDocument: client.identificationNumber,
                            createdBy,
                            notes: (dto.notes || `Recarga de billetera (EFECTIVO)`) + ` | Cédula: ${client.identificationNumber} | Tipo: RECARGA_BILLETERA`,
                            bankAccountId: finalBankAccountId!,
                            source: 'MANUAL',
                            paymentMethod: 'EFECTIVO',
                            movementType: 'INCOME',
                            fromAccountType: 'EXTERNAL',
                            toAccountType: 'BANK_ACCOUNT',
                            transactionGroupId: groupId,
                            balanceBefore,
                            balanceAfter,
                            version: 1
                        }
                    });

                    // 2. INTERNAL: From cash account to client wallet
                    await tx.financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: internalRef,
                            userReference: dto.reference || null,
                            amount: dto.amount,
                            date: new Date(),
                            clientId: dto.clientId,
                            clientName,
                            clientDocument: client.identificationNumber,
                            createdBy,
                            notes: `Ingreso a billetera virtual (EFECTIVO) | Cédula: ${client.identificationNumber} | Tipo: RECARGA_BILLETERA`,
                            bankAccountId: finalBankAccountId!,
                            source: 'MANUAL',
                            paymentMethod: 'EFECTIVO',
                            movementType: 'INTERNAL',
                            fromAccountType: 'BANK_ACCOUNT',
                            toAccountType: 'WALLET',
                            transactionGroupId: groupId,
                            balanceBefore: walletBalanceBefore,
                            balanceAfter: walletBalanceAfter,
                            version: 1
                        }
                    });

                    // 3. Create credit record
                    await tx.clientCredit.create({
                        data: {
                            clientAccountId,
                            amount: dto.amount,
                            remainingAmount: dto.amount,
                            originTransactionId: incomeFR.id,
                            status: 'AVAILABLE'
                        }
                    });

                    // 4. Update balances
                    await tx.clientAccount.update({
                        where: { id: clientAccountId },
                        data: {
                            totalCreditAvailable: { increment: dto.amount },
                            version: { increment: 1 }
                        }
                    });

                    if (finalBankAccountId) {
                        await tx.bankAccount.update({
                            where: { id: finalBankAccountId },
                            data: {
                                currentBalance: { increment: dto.amount },
                                version: { increment: 1 }
                            }
                        });
                    }
                }

                return recharge;
            });

            return Result.ok(result);

        } catch (error) {
            console.error('CreateWalletRechargeUseCase Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Failed to create wallet recharge');
        }
    }
}
