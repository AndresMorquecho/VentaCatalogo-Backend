
import { Result } from '../../../shared/domain/Result';
import { IOrderRepository } from '../../orders/domain/IOrderRepository';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { IBankAccountRepository } from '../../financial/domain/IBankAccountRepository';
import { FinancialRecord } from '../../financial/domain/FinancialRecord.entity';
import { prisma } from '../../../lib/prisma';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientCreditBalance } from '../../../shared/utils/financialValidations';

export interface RegisterOrderPaymentDTO {
    orderId: string;
    amount: number;
    method: string;
    referenceNumber?: string;
    bankAccountId?: string;
    notes?: string;
    creditAmount?: number;
}

export class RegisterOrderPaymentUseCase {
    constructor(
        private orderRepository: IOrderRepository,
        private financialRepository: IFinancialRecordRepository,
        private bankAccountRepository: IBankAccountRepository
    ) { }

    async execute(dto: RegisterOrderPaymentDTO, createdBy: string): Promise<Result<any>> {
        try {
            // 1. Verify existence of core entities before transaction
            const order = await this.orderRepository.findById(dto.orderId);
            if (!order) return Result.fail(`Order with ID ${dto.orderId} not found`);

            if (dto.amount > 0 && !dto.bankAccountId) {
                return Result.fail(`Bank account is required when adding a payment amount`);
            }

            if (dto.amount === 0 && (!dto.creditAmount || dto.creditAmount <= 0)) {
                return Result.fail(`Must provide an amount or creditAmount to register a payment`);
            }

            let bankAccount = null;
            if (dto.amount > 0 && dto.bankAccountId) {
                bankAccount = await this.bankAccountRepository.findById(dto.bankAccountId);
                if (!bankAccount) return Result.fail(`Bank account with ID ${dto.bankAccountId} not found`);
            }

            // 2. Validate reference duplicates if not CASH
            if (dto.amount > 0 && dto.method !== 'EFECTIVO' && dto.referenceNumber) {
                const existing = await prisma.financialRecord.findFirst({
                    where: { referenceNumber: dto.referenceNumber }
                });
                if (existing) {
                    return Result.fail(`La referencia ${dto.referenceNumber} ya fue utilizada en una transacción previa (Método: ${existing.paymentMethod || 'Otro'}).`);
                }
            }

            const result = await prisma.$transaction(async (tx) => {
                let mainPayment = null;

                // --- MANUAL PAYMENT PORTION ---
                if (dto.amount > 0) {
                    const finRef = dto.method !== 'EFECTIVO' && dto.referenceNumber
                        ? dto.referenceNumber
                        : await this.financialRepository.generateReferenceNumber();

                    const payRef = await this.financialRepository.generatePaymentReceiptNumber();
                    mainPayment = await tx.orderPayment.create({
                        data: {
                            orderId: dto.orderId,
                            amount: dto.amount,
                            method: dto.method,
                            reference: dto.referenceNumber || null,
                            receiptNumber: payRef,
                            description: dto.notes || 'Abono posterior'
                        }
                    });

                    await tx.financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: finRef,
                            amount: dto.amount,
                            date: new Date(),
                            clientId: order.clientId,
                            clientName: order.clientName,
                            orderId: order.id,
                            orderPaymentId: mainPayment.id,
                            createdBy,
                            notes: dto.notes || `Abono a pedido ${order.receiptNumber}`,
                            bankAccountId: dto.bankAccountId!,
                            source: 'ORDER_PAYMENT',
                            paymentMethod: dto.method,
                            movementType: 'INCOME',
                            version: 1
                        }
                    });

                    // Read account with version
                    const bankAccount = await tx.bankAccount.findUnique({
                        where: { id: dto.bankAccountId },
                        select: { id: true, currentBalance: true, version: true, name: true }
                    });

                    if (!bankAccount) {
                        throw new Error(`Bank account ${dto.bankAccountId} not found`);
                    }

                    // Validate financial integrity
                    validateBankAccountBalance(
                        Number(bankAccount.currentBalance),
                        dto.amount,
                        dto.bankAccountId,
                        bankAccount.name
                    );

                    // Update with optimistic locking
                    const result = await tx.bankAccount.updateMany({
                        where: {
                            id: dto.bankAccountId,
                            version: bankAccount.version
                        },
                        data: {
                            currentBalance: { increment: dto.amount },
                            updatedAt: new Date(),
                            version: { increment: 1 }
                        }
                    });

                    if (result.count === 0) {
                        throw new ConcurrencyError(
                            'Bank account was modified by another transaction. Please retry.',
                            'BankAccount',
                            dto.bankAccountId
                        );
                    }
                }

                // --- CREDIT USED PORTION ---
                let creditPayment = null;
                if (dto.creditAmount && dto.creditAmount > 0) {
                    const availableCredits = await tx.clientCredit.findMany({
                        where: {
                            clientAccount: { clientId: order.clientId },
                            status: 'AVAILABLE'
                        },
                        select: {
                            id: true,
                            remainingAmount: true,
                            version: true,
                            status: true
                        },
                        orderBy: { createdAt: 'asc' }
                    });

                    let remainingToSubtract = dto.creditAmount;
                    for (const credit of availableCredits) {
                        if (remainingToSubtract <= 0) break;
                        const amountToSubtract = Math.min(Number(credit.remainingAmount), remainingToSubtract);

                        // Validate financial integrity
                        validateClientCreditBalance(
                            Number(credit.remainingAmount),
                            amountToSubtract,
                            credit.id
                        );

                        const newRemainingAmount = Number(credit.remainingAmount) - amountToSubtract;
                        const newStatus = newRemainingAmount <= 0.01 ? 'USED' : 'AVAILABLE';

                        // Update with optimistic locking
                        const result = await tx.clientCredit.updateMany({
                            where: {
                                id: credit.id,
                                version: credit.version
                            },
                            data: {
                                remainingAmount: { decrement: amountToSubtract },
                                status: newStatus,
                                version: { increment: 1 }
                            }
                        });

                        if (result.count === 0) {
                            throw new ConcurrencyError(
                                'Client credit was modified by another transaction. Please retry.',
                                'ClientCredit',
                                credit.id
                            );
                        }

                        remainingToSubtract -= amountToSubtract;
                    }

                    if (remainingToSubtract > 0.01) {
                        throw new Error(`Saldo a favor insuficiente para cubrir $${dto.creditAmount.toFixed(2)}`);
                    }

                    // TASK-4.2: Sync ClientAccount.totalCreditAvailable after consuming credit with optimistic locking
                    const clientAccount = await tx.clientAccount.findUnique({
                        where: { clientId: order.clientId },
                        select: { id: true, totalCreditAvailable: true, version: true }
                    });

                    if (clientAccount) {
                        const accountResult = await tx.clientAccount.updateMany({
                            where: {
                                id: clientAccount.id,
                                version: clientAccount.version
                            },
                            data: {
                                totalCreditAvailable: { decrement: dto.creditAmount },
                                version: { increment: 1 }
                            }
                        });

                        if (accountResult.count === 0) {
                            throw new ConcurrencyError(
                                'Client account was modified by another transaction. Please retry.',
                                'ClientAccount',
                                clientAccount.id
                            );
                        }
                    }

                    const creditPayRef = await this.financialRepository.generatePaymentReceiptNumber();
                    creditPayment = await tx.orderPayment.create({
                        data: {
                            orderId: dto.orderId,
                            amount: dto.creditAmount,
                            method: 'CREDITO_CLIENTE',
                            receiptNumber: creditPayRef,
                            description: 'Abono con saldo a favor'
                        }
                    });

                    // Need a real bank account ID for the foreign key, use the provided one or fallback to CASH account
                    let creditBankAccountId = dto.bankAccountId;
                    if (!creditBankAccountId || creditBankAccountId === 'default') {
                        const cashAcc = await tx.bankAccount.findFirst({ where: { type: 'CASH' } });
                        if (cashAcc) {
                            creditBankAccountId = cashAcc.id;
                        }
                    }

                    await tx.financialRecord.create({
                        data: {
                            type: 'PAYMENT',
                            referenceNumber: `REF-CRED-${Date.now()}`,
                            amount: dto.creditAmount,
                            date: new Date(),
                            clientId: order.clientId,
                            clientName: order.clientName,
                            orderId: order.id,
                            orderPaymentId: creditPayment.id,
                            createdBy,
                            notes: 'Abono con saldo a favor',
                            bankAccountId: creditBankAccountId!,
                            source: 'ORDER_PAYMENT',
                            paymentMethod: 'CREDITO_CLIENTE',
                            movementType: 'INCOME',
                            version: 1
                        }
                    });
                }

                return mainPayment || creditPayment;
            });

            return Result.ok(result);

        } catch (error) {
            console.error('RegisterOrderPaymentUseCase Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Failed to register payment');
        }
    }
}
