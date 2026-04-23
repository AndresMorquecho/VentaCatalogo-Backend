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
    transactionDate?: string;
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

            const result = await prisma.$transaction(async (tx) => {
                // --- 🔒 CONCURRENCY & DUPLICATE CHECK ---
                if (dto.reference) {
                    const trimmedRef = dto.reference.trim();
                    console.log(`[InstantRecharge] Checking duplicate reference: ${trimmedRef}`);
                    
                    const existingRef = await tx.walletRecharge.findFirst({
                        where: { reference: { equals: trimmedRef, mode: 'insensitive' } }
                    });
                    if (existingRef) {
                        throw new Error(`El número de TRANSACCIÓN / DOC "${trimmedRef}" ya ha sido utilizado en otra solicitud previa.`);
                    }

                    const existingFin = await tx.financialRecord.findFirst({
                        where: { userReference: { equals: trimmedRef, mode: 'insensitive' } }
                    });
                    if (existingFin) {
                        throw new Error(`El documento "${trimmedRef}" ya existe en los registros financieros globales.`);
                    }
                }

                if (dto.controlValidation) {
                    const trimmedControl = dto.controlValidation.trim();
                    console.log(`[InstantRecharge] Checking duplicate control: ${trimmedControl}`);

                    const existingControl = await tx.walletRecharge.findFirst({
                        where: { controlValidation: { equals: trimmedControl, mode: 'insensitive' } }
                    });
                    if (existingControl) {
                        throw new Error(`El código de CONTROL / VALIDACIÓN "${trimmedControl}" ya ha sido utilizado anteriormente.`);
                    }
                }

                const clientName = (client as any).lastName
                    ? `${client.firstName} ${(client as any).lastName}`
                    : client.firstName;
                    
                let clientAccountId = client.clientAccount?.id;
                if (!clientAccountId) {
                    const newAccount = await tx.clientAccount.create({
                        data: { clientId: dto.clientId, totalCreditAvailable: 0 }
                    });
                    clientAccountId = newAccount.id;
                }

                // --- ⚖️ STATUS DETERMINATION ---
                // Currently InstantWalletRecharge only allows TRANSFERENCIA, DEPOSITO, CHEQUE
                // These MUST be validated by an admin first.
                // EFECTIVO (if ever added here) would be the only one validated immediately.
                const isInstant = dto.paymentMethod === 'EFECTIVO';
                const status = isInstant ? 'VALIDADO' : 'PENDIENTE_VALIDACION';

                const transactionDate = dto.transactionDate 
                    ? new Date(dto.transactionDate.includes('T') ? dto.transactionDate : `${dto.transactionDate}T12:00:00Z`) 
                    : new Date();

                // 2. Create the Recharge record
                const recharge = await tx.walletRecharge.create({
                    data: {
                        clientId: dto.clientId,
                        amount: dto.amount,
                        paymentMethod: dto.paymentMethod,
                        bankAccountId: dto.bankAccountId,
                        reference: dto.reference || null,
                        controlValidation: dto.controlValidation || null,
                        notes: dto.notes || null,
                        status: status,
                        createdByName: createdBy,
                        validatedByName: isInstant ? createdBy : null,
                        validatedAt: isInstant ? transactionDate : null,
                        createdAt: transactionDate
                    }
                });

                // --- 💰 FINANCIAL PROCESSING (ONLY IF EFECTIVO) ---
                if (isInstant) {
                    const refNumber = dto.reference || await this.financialRepository.generateReferenceNumber();
                    const groupId = crypto.randomUUID();
                    const internalRef = `REC-${recharge.id.substring(0, 8)}-${refNumber}-INT`;

                    const bankSnap = await tx.bankAccount.findUnique({
                        where: { id: dto.bankAccountId },
                        select: { currentBalance: true }
                    });
                    const balanceBefore = bankSnap ? parseFloat(bankSnap.currentBalance.toString()) : 0;
                    const balanceAfter = balanceBefore + dto.amount;

                    const currentAccount = await tx.clientAccount.findUnique({
                        where: { id: clientAccountId },
                        select: { totalCreditAvailable: true, version: true }
                    });
                    const walletBalanceBefore = parseFloat(currentAccount!.totalCreditAvailable.toString());
                    const walletBalanceAfter = walletBalanceBefore + dto.amount;

                    const incomeFR = await tx.financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: `REC-${recharge.id.substring(0, 8)}-${refNumber}`,
                            userReference: dto.reference || null,
                            amount: dto.amount,
                            date: transactionDate,
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

                    await tx.financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: internalRef,
                            userReference: dto.reference || null,
                            amount: dto.amount,
                            date: transactionDate,
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

                    await tx.clientCredit.create({
                        data: {
                            clientAccountId,
                            amount: dto.amount,
                            remainingAmount: dto.amount,
                            originTransactionId: incomeFR.id,
                            status: 'AVAILABLE'
                        }
                    });

                    await tx.clientAccount.updateMany({
                        where: { id: clientAccountId, version: currentAccount!.version },
                        data: {
                            totalCreditAvailable: { increment: dto.amount },
                            version: { increment: 1 }
                        }
                    });

                    await tx.bankAccount.updateMany({
                        where: { id: dto.bankAccountId },
                        data: {
                            currentBalance: { increment: dto.amount },
                            updatedAt: new Date(),
                            version: { increment: 1 }
                        }
                    });
                }

                // 7. Return current balance (will be after increment if cash, otherwise same as before)
                const finalAccount = await tx.clientAccount.findUnique({
                    where: { id: clientAccountId },
                    select: { totalCreditAvailable: true }
                });

                return { newBalance: Number(finalAccount?.totalCreditAvailable || 0) };
            });

            return Result.ok(result);

        } catch (error: any) {
            console.error('InstantWalletRechargeUseCase Error:', error);
            
            // Check for Prisma unique constraint violation code
            if (error.code === 'P2002') {
                return Result.fail('Conflicto: El N° TRANSACCIÓN o CONTROL ya fueron registrados en otra ventana o por otro usuario.');
            }

            return Result.fail(error instanceof Error ? error.message : 'Failed to process instant recharge');
        }
    }
}
