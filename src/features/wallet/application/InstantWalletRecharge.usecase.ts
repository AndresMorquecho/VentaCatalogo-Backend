import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';

export interface InstantWalletRechargeDTO {
    clientId: string;
    amount: number;
    paymentMethod: string; // TRANSFERENCIA | DEPOSITO | CHEQUE
    bankAccountId: string;
    reference?: string;
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

                // 3. Create ClientCredit
                await tx.clientCredit.create({
                    data: {
                        clientAccountId,
                        amount: dto.amount,
                        remainingAmount: dto.amount,
                        originTransactionId: recharge.id,
                        status: 'AVAILABLE'
                    }
                });

                // 4. Update ClientAccount.totalCreditAvailable with optimistic locking
                const currentAccount = await tx.clientAccount.findUnique({
                    where: { id: clientAccountId },
                    select: { id: true, totalCreditAvailable: true, version: true }
                });

                await tx.clientAccount.updateMany({
                    where: { id: clientAccountId, version: currentAccount!.version },
                    data: {
                        totalCreditAvailable: { increment: dto.amount },
                        version: { increment: 1 }
                    }
                });

                // 5. Create FinancialRecord
                const refNumber = dto.reference || await this.financialRepository.generateReferenceNumber();
                await tx.financialRecord.create({
                    data: {
                        type: 'PAYMENT',
                        referenceNumber: `REC-${recharge.id.substring(0, 8)}-${refNumber}`,
                        amount: dto.amount,
                        date: new Date(),
                        clientId: dto.clientId,
                        clientName,
                        createdBy,
                        notes: dto.notes || `Recarga rápida de billetera (${dto.paymentMethod})`,
                        bankAccountId: dto.bankAccountId,
                        source: 'MANUAL',
                        paymentMethod: dto.paymentMethod,
                        movementType: 'INCOME',
                        version: 1
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
