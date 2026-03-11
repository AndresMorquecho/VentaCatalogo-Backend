
import { Result } from '../../../shared/domain/Result';
import { IOrderRepository } from '../../orders/domain/IOrderRepository';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { IBankAccountRepository } from '../../financial/domain/IBankAccountRepository';
import { FinancialRecord } from '../../financial/domain/FinancialRecord.entity';
import { prisma } from '../../../lib/prisma';

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

                    await tx.bankAccount.update({
                        where: { id: dto.bankAccountId },
                        data: {
                            currentBalance: { increment: dto.amount },
                            version: { increment: 1 }
                        }
                    });
                }

                // --- CREDIT USED PORTION ---
                let creditPayment = null;
                if (dto.creditAmount && dto.creditAmount > 0) {
                    const availableCredits = await tx.clientCredit.findMany({
                        where: {
                            clientAccount: { clientId: order.clientId },
                            status: 'AVAILABLE'
                        },
                        orderBy: { createdAt: 'asc' }
                    });

                    let remainingToSubtract = dto.creditAmount;
                    for (const credit of availableCredits) {
                        if (remainingToSubtract <= 0) break;
                        const amountToSubtract = Math.min(Number(credit.remainingAmount), remainingToSubtract);

                        await tx.clientCredit.update({
                            where: { id: credit.id },
                            data: {
                                remainingAmount: { decrement: amountToSubtract },
                                status: Number(credit.remainingAmount) - amountToSubtract <= 0.01 ? 'USED' : 'AVAILABLE'
                            }
                        });
                        remainingToSubtract -= amountToSubtract;
                    }

                    if (remainingToSubtract > 0.01) {
                        throw new Error(`Saldo a favor insuficiente para cubrir $${dto.creditAmount.toFixed(2)}`);
                    }

                    // TASK-4.2: Sync ClientAccount.totalCreditAvailable after consuming credit
                    const clientAccount = await tx.clientAccount.findUnique({
                        where: { clientId: order.clientId }
                    });
                    if (clientAccount) {
                        await tx.clientAccount.update({
                            where: { id: clientAccount.id },
                            data: {
                                totalCreditAvailable: { decrement: dto.creditAmount },
                                version: { increment: 1 }
                            }
                        });
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
