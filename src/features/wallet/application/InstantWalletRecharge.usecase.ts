import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { buildNotesJSON, cardTitleFromMethod } from '../../../shared/utils/transactionNotes';

export interface InstantWalletRechargeDTO {
    clientId: string;
    amount: number;
    paymentMethod: string; // TRANSFERENCIA | DEPOSITO | CHEQUE
    bankAccountId: string;
    reference?: string;
    controlValidation?: string;
    notes?: string;
}

/**
 * Instant wallet recharge: creates WalletRecharge + validates it immediately
 * in a single atomic transaction. Used from the payment modal quick-recharge flow.
 */
export class InstantWalletRechargeUseCase {
    constructor(
        private financialRepository: IFinancialRecordRepository
    ) { }

    async execute(dto: InstantWalletRechargeDTO, createdBy: string): Promise<Result<{ newBalance: number }>> {
        try {
            if (!dto.clientId) return Result.fail('Client ID is required');
            if (!dto.amount || dto.amount <= 0) return Result.fail('Amount must be greater than 0');
            if (!dto.bankAccountId) return Result.fail('Bank account is required');

            const ALLOWED_METHODS = ['TRANSFERENCIA', 'DEPOSITO', 'CHEQUE'];
            if (!ALLOWED_METHODS.includes(dto.paymentMethod)) {
                return Result.fail(`Payment method must be one of: ${ALLOWED_METHODS.join(', ')}`);
            }

            const client = await prisma.client.findUnique({
                where: { id: dto.clientId },
                include: { clientAccount: true }
            });
            if (!client) return Result.fail(`Client ${dto.clientId} not found`);

            const bankAccount = await prisma.bankAccount.findUnique({
                where: { id: dto.bankAccountId },
                select: { id: true, name: true, currentBalance: true, version: true }
            });
            if (!bankAccount) return Result.fail(`Bank account ${dto.bankAccountId} not found`);

            // Validate duplicate reference
            if (dto.reference) {
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
                const existingFin = await prisma.financialRecord.findFirst({
                    where: { referenceNumber: dto.reference }
                });
                if (existingFin) {
                    return Result.fail(`La referencia ${dto.reference} ya existe en los registros financieros.`);
                }
            }

            const clientName = (client as any).lastName
                ? `${client.firstName} ${(client as any).lastName}`
                : client.firstName;

            const result = await prisma.$transaction(async (tx) => {
                // 1. Ensure client account exists
                let clientAccountId = client.clientAccount?.id;
                if (!clientAccountId) {
                    const newAccount = await tx.clientAccount.create({
                        data: { clientId: dto.clientId, totalCreditAvailable: 0 }
                    });
                    clientAccountId = newAccount.id;
                }

                // 2. Create WalletRecharge already VALIDADO
                const recharge = await tx.walletRecharge.create({
                    data: {
                        clientId: dto.clientId,
                        amount: dto.amount,
                        paymentMethod: dto.paymentMethod,
                        bankAccountId: dto.bankAccountId,
                        reference: dto.reference || null,
                        notes: dto.notes || null,
                        status: 'VALIDADO',
                        createdByName: createdBy,
                        validatedByName: createdBy,
                        validatedAt: new Date()
                    }
                });

                // 3. Create FinancialRecords FIRST (INCOME + INTERNAL, grouped)
                const refNumber = dto.reference || await this.financialRepository.generateReferenceNumber();
                const groupId = crypto.randomUUID();
                const internalRef = `REC-${recharge.id.substring(0, 8)}-${refNumber}-INT`;

                // Bank balance snapshot BEFORE update
                const bankSnap = await tx.bankAccount.findUnique({
                    where: { id: dto.bankAccountId },
                    select: { currentBalance: true }
                });
                const balanceBefore = bankSnap ? parseFloat(bankSnap.currentBalance.toString()) : 0;
                const balanceAfter = balanceBefore + dto.amount;

                // Wallet balance snapshot BEFORE update
                const currentAccount = await tx.clientAccount.findUnique({
                    where: { id: clientAccountId },
                    select: { totalCreditAvailable: true, version: true }
                });
                const walletBalanceBefore = parseFloat(currentAccount!.totalCreditAvailable.toString());
                const walletBalanceAfter = walletBalanceBefore + dto.amount;

                // 3a. INCOME: external money → bank account
                const incomeFR = await tx.financialRecord.create({
                    data: {
                        type: 'PAYMENT',
                        referenceNumber: `REC-${recharge.id.substring(0, 8)}-${refNumber}`,
                        userReference: dto.reference || null,
                        amount: dto.amount,
                        date: new Date(),
                        clientId: dto.clientId,
                        clientName,
                        clientDocument: (client as any).identificationNumber ?? null,
                        createdBy,
                        notes: buildNotesJSON({
                            title: cardTitleFromMethod(dto.paymentMethod),
                            module: 'WALLET',
                            clientDoc: (client as any).identificationNumber || 'S/N',
                            orders: [],
                            description: dto.notes,
                            extra: dto.controlValidation ? `Control: ${dto.controlValidation}` : undefined
                        }),
                        bankAccountId: dto.bankAccountId,
                        source: 'MANUAL',
                        paymentMethod: dto.paymentMethod as any,
                        movementType: 'INCOME',
                        fromAccountType: 'EXTERNAL',
                        toAccountType: 'BANK_ACCOUNT',
                        transactionGroupId: groupId,
                        balanceBefore,
                        balanceAfter,
                        version: 1
                    }
                });

                // 3b. INTERNAL: bank account → client wallet
                await tx.financialRecord.create({
                    data: {
                        type: 'PAYMENT',
                        referenceNumber: internalRef,
                        userReference: dto.reference || null,
                        amount: dto.amount,
                        date: new Date(),
                        clientId: dto.clientId,
                        clientName,
                        clientDocument: (client as any).identificationNumber ?? null,
                        createdBy,
                        notes: buildNotesJSON({
                            title: 'RECARGA_BILLETERA',
                            module: 'WALLET',
                            clientDoc: (client as any).identificationNumber || 'S/N',
                            orders: [],
                            description: dto.notes,
                            extra: dto.controlValidation ? `Control: ${dto.controlValidation}` : undefined
                        }),
                        bankAccountId: dto.bankAccountId,
                        source: 'MANUAL',
                        paymentMethod: dto.paymentMethod as any,
                        movementType: 'INTERNAL',
                        fromAccountType: 'BANK_ACCOUNT',
                        toAccountType: 'WALLET',
                        transactionGroupId: groupId,
                        balanceBefore: walletBalanceBefore,
                        balanceAfter: walletBalanceAfter,
                        version: 1
                    }
                });

                // 4. Create ClientCredit with CORRECT originTransactionId (INCOME FR)
                await tx.clientCredit.create({
                    data: {
                        clientAccountId,
                        amount: dto.amount,
                        remainingAmount: dto.amount,
                        originTransactionId: incomeFR.id,
                        status: 'AVAILABLE'
                    }
                });

                // 5. Update ClientAccount.totalCreditAvailable with optimistic locking
                await tx.clientAccount.updateMany({
                    where: { id: clientAccountId, version: currentAccount!.version },
                    data: {
                        totalCreditAvailable: { increment: dto.amount },
                        version: { increment: 1 }
                    }
                });

                // 6. Update BankAccount balance with optimistic locking
                const bankAcc = await tx.bankAccount.findUnique({
                    where: { id: dto.bankAccountId },
                    select: { id: true, currentBalance: true, version: true }
                });

                await tx.bankAccount.updateMany({
                    where: { id: dto.bankAccountId, version: bankAcc!.version },
                    data: {
                        currentBalance: { increment: dto.amount },
                        updatedAt: new Date(),
                        version: { increment: 1 }
                    }
                });

                // 7. Return new balance
                const updatedAccount = await tx.clientAccount.findUnique({
                    where: { clientId: dto.clientId },
                    select: { totalCreditAvailable: true }
                });

                return { newBalance: Number(updatedAccount?.totalCreditAvailable || 0) };
            });

            return Result.ok(result);

        } catch (error) {
            console.error('InstantWalletRechargeUseCase Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Failed to process instant recharge');
        }
    }
}
