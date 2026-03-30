
import { Result } from '../../../shared/domain/Result';
import { IOrderRepository } from '../../orders/domain/IOrderRepository';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { IBankAccountRepository } from '../../financial/domain/IBankAccountRepository';
import { prisma } from '../../../lib/prisma';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientCreditBalance } from '../../../shared/utils/financialValidations';
import { Order, OrderStatus } from '../../orders/domain/Order.entity';
import { buildNotesJSON, cardTitleFromMethod, generateGroupId } from '../../../shared/utils/transactionNotes';

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

    private static readonly BLOCKED_METHODS = ['TRANSFERENCIA', 'DEPOSITO', 'CHEQUE'];

    async execute(dto: RegisterOrderPaymentDTO, createdBy: string, existingTx?: any): Promise<Result<any>> {
        const txClient = existingTx || prisma;
        try {
            // Validate payment method — TRANSFERENCIA/DEPOSITO/CHEQUE only allowed for wallet recharges
            if (RegisterOrderPaymentUseCase.BLOCKED_METHODS.includes(dto.method)) {
                return Result.fail(`El método "${dto.method}" no está permitido para abonos directos. Use EFECTIVO o BILLETERA_VIRTUAL.`);
            }

            // 1. Verify existence of core entities before transaction
            const order = await this.orderRepository.findById(dto.orderId);
            if (!order) return Result.fail(`Order with ID ${dto.orderId} not found`);

            const client = await txClient.client.findUnique({
                where: { id: order.clientId },
                select: { identificationNumber: true, id: true }
            });
            const clientDoc = client?.identificationNumber || 'S/N';

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
                const existing = await txClient.financialRecord.findFirst({
                    where: { referenceNumber: dto.referenceNumber }
                });
                if (existing) {
                    return Result.fail(`La referencia ${dto.referenceNumber} ya fue utilizada en una transacción previa (Método: ${existing.paymentMethod || 'Otro'}).`);
                }
            }

            // A shared groupId links the cash leg + wallet leg into ONE card in the UI
            const sharedGroupId = (dto.amount > 0 && dto.creditAmount && dto.creditAmount > 0)
                ? generateGroupId()
                : undefined;

            const runInTransaction = async (tx: any) => {
                let mainPayment = null;

                // --- MANUAL PAYMENT PORTION ---
                if (dto.amount > 0) {
                    // Fetch account once for both validation and balance snapshot
                    const bankAccount = await tx.bankAccount.findUnique({
                        where: { id: dto.bankAccountId },
                        select: { id: true, currentBalance: true, version: true, name: true, type: true }
                    });

                    if (!bankAccount) {
                        throw new Error(`Bank account ${dto.bankAccountId} not found`);
                    }

                    // Validate financial integrity
                    validateBankAccountBalance(
                        Number(bankAccount.currentBalance),
                        dto.amount,
                        dto.bankAccountId!,
                        bankAccount.name
                    );

                    const balanceBefore = Number(bankAccount.currentBalance);
                    const balanceAfter = balanceBefore + dto.amount;

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

                    const notesJson = buildNotesJSON({
                        title: cardTitleFromMethod(dto.method),
                        module: 'ORDERS',
                        clientDoc,
                        orders: [{
                            receiptNumber: order.receiptNumber,
                            orderNumber: order.orderNumber ?? undefined,
                            brandName: order.brandName ?? undefined,
                        }],
                        extra: dto.notes || undefined,
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
                            notes: notesJson,
                            userReference: payRef,
                            bankAccountId: dto.bankAccountId!,
                            source: 'ORDER_PAYMENT',
                            paymentMethod: dto.method,
                            movementType: dto.method === 'BILLETERA_VIRTUAL' ? 'INTERNAL' : 'INCOME',
                            fromAccountType: dto.method === 'BILLETERA_VIRTUAL' ? 'WALLET' : 'EXTERNAL',
                            toAccountType: dto.method === 'BILLETERA_VIRTUAL' ? 'ORDER' : 'CASH',
                            clientDocument: clientDoc,
                            balanceBefore,
                            balanceAfter,
                            transactionGroupId: sharedGroupId ?? finRef,
                            version: 1,
                            createdAt: new Date()
                        }
                    });

                    // Update with optimistic locking
                    const result = await tx.bankAccount.updateMany({
                        where: { id: dto.bankAccountId, version: bankAccount.version },
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
                    // Optimized query: get account specifically
                    const clientAccount = await tx.clientAccount.findUnique({
                        where: { clientId: order.clientId },
                        select: { id: true, totalCreditAvailable: true, version: true }
                    });

                    if (!clientAccount) {
                        throw new Error(`No se encontró cuenta activa para el cliente ${order.clientName}`);
                    }

                    const availableCredits = await tx.clientCredit.findMany({
                        where: {
                            clientAccountId: clientAccount.id,
                            status: 'AVAILABLE'
                        },
                        select: {
                            id: true,
                            remainingAmount: true,
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

                        // Update credit (without optimistic locking - version field not in DB)
                        const result = await tx.clientCredit.updateMany({
                            where: {
                                id: credit.id
                            },
                            data: {
                                remainingAmount: { decrement: amountToSubtract },
                                status: newStatus,
                                usedAt: newStatus === 'USED' ? new Date() : undefined
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

                    const creditNotesJson = buildNotesJSON({
                        title: 'USO_BILLETERA',
                        module: 'ORDERS',
                        clientDoc,
                        orders: [{
                            receiptNumber: order.receiptNumber,
                            orderNumber: order.orderNumber ?? undefined,
                            brandName: order.brandName ?? undefined,
                        }],
                    });

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
                            notes: creditNotesJson,
                            userReference: creditPayRef,
                            bankAccountId: creditBankAccountId!,
                            source: 'ORDER_PAYMENT',
                            paymentMethod: 'CREDITO_CLIENTE',
                            movementType: 'INTERNAL',
                            fromAccountType: 'WALLET',
                            toAccountType: 'ORDER',
                            clientDocument: clientDoc,
                            balanceBefore: Number(clientAccount.totalCreditAvailable),
                            balanceAfter: Number(clientAccount.totalCreditAvailable) - dto.creditAmount,
                            transactionGroupId: sharedGroupId ?? `REF-CRED-${Date.now()}`,
                            version: 1
                        }
                    });
                }

                // --- SYNC ORDER STATUS ---
                // We reload the order data from DB (in tx) or just use the updated payments count
                const allPayments = await tx.orderPayment.findMany({
                    where: { orderId: dto.orderId },
                    select: { amount: true }
                });
                
                const totalPaid = allPayments.reduce((acc: number, p: any) => acc + Number(p.amount), 0);
                const orderTotal = Number(order.realInvoiceTotal || order.total);


                return mainPayment || creditPayment;
            };

            // Eexecute in existing transaction or new one
            const finalResult = existingTx 
                ? await runInTransaction(existingTx) 
                : await prisma.$transaction(runInTransaction);

            return Result.ok(finalResult);

        } catch (error) {
            console.error('RegisterOrderPaymentUseCase Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Failed to register payment');
        }
    }
}
