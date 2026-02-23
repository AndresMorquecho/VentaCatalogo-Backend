
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
    bankAccountId: string;
    notes?: string;
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

            const bankAccount = await this.bankAccountRepository.findById(dto.bankAccountId);
            if (!bankAccount) return Result.fail(`Bank account with ID ${dto.bankAccountId} not found`);

            // 2. Validate reference duplicates if not CASH
            if (dto.method !== 'EFECTIVO' && dto.referenceNumber) {
                const whereClause: any = {
                    paymentMethod: dto.method,
                    referenceNumber: dto.referenceNumber
                };
                if (dto.method === 'CHEQUE') {
                    whereClause.bankAccountId = dto.bankAccountId;
                }
                const existing = await prisma.financialRecord.findFirst({
                    where: whereClause
                });
                if (existing) {
                    return Result.fail(`La referencia ${dto.referenceNumber} ya fue utilizada en otro pago de tipo ${dto.method}.`);
                }
            }

            // 3. Determine Final Reference Number
            const finRef = dto.method !== 'EFECTIVO' && dto.referenceNumber
                ? dto.referenceNumber
                : await this.financialRepository.generateReferenceNumber();

            // 3. Execute all in a transaction
            const result = await prisma.$transaction(async (tx) => {
                // a. Create Order Payment
                const payment = await tx.orderPayment.create({
                    data: {
                        orderId: dto.orderId,
                        amount: dto.amount,
                        method: dto.method,
                        reference: dto.referenceNumber || null,
                        description: dto.notes || 'Abono posterior'
                    }
                });

                // b. Create Financial Record
                await tx.financialRecord.create({
                    data: {
                        type: 'PAYMENT',
                        referenceNumber: finRef,
                        amount: dto.amount,
                        date: new Date(),
                        clientId: order.clientId,
                        clientName: order.clientName,
                        orderId: order.id,
                        createdBy,
                        notes: dto.notes || `Abono a pedido ${order.receiptNumber}`,
                        bankAccountId: dto.bankAccountId,
                        source: 'ORDER_PAYMENT',
                        paymentMethod: dto.method,
                        movementType: 'INCOME',
                        version: 1
                    }
                });

                // c. Update Bank Account Balance
                await tx.bankAccount.update({
                    where: { id: dto.bankAccountId },
                    data: {
                        currentBalance: { increment: dto.amount },
                        version: { increment: 1 }
                    }
                });

                return payment;
            });

            return Result.ok(result);
        } catch (error) {
            console.error('RegisterOrderPaymentUseCase Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Failed to register payment');
        }
    }
}
