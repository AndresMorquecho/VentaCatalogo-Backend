import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientAccountCredit } from '../../../shared/utils/financialValidations';
import { buildNotesJSON, cardTitleFromMethod, generateGroupId } from '../../../shared/utils/transactionNotes';
import crypto from 'crypto';

export interface BatchUpdateOrdersDTO {
    receiptNumber: string;
    clientId: string;
    salesChannel: string;
    createdAt: Date;
    paymentMethod: string;
    bankAccountId?: string;
    transactionDate: Date;
    createdByName?: string;
    notes?: string;
    toDelete: string[];
    idempotencyKey?: string;
    orders: Array<{
        id?: string;
        brandId: string;
        brandName: string;
        total: number;
        deposit: number;
        type: string;
        possibleDeliveryDate: Date;
        orderNumber?: string;
        quantity: number;
        sourceOrderId?: string;
        sourceOrderNumber?: string;
        sourceBrandName?: string;
        sourceQuantity?: number;
        sourceDescription?: string;
        description?: string;
        notes?: string;
        status?: string;
    }>;
}

export class BatchUpdateOrdersUseCase {
    async execute(dto: BatchUpdateOrdersDTO, updatedBy: string): Promise<Result<any>> {
        const receiptNumber = (dto.receiptNumber || '').trim();
        if (!receiptNumber) return Result.fail('Receipt number is required');

        try {
            return await prisma.$transaction(async (tx) => {
                // 1. CONCURRENCY LOCK & CONTEXT
                const receipt = await (tx as any).orderReceipt.findUnique({
                    where: { receiptNumber },
                    select: { id: true, version: true, clientId: true }
                });
                if (!receipt) throw new Error(`El recibo ${receiptNumber} no existe`);

                await (tx as any).orderReceipt.update({
                    where: { id: receipt.id },
                    data: { 
                        version: { increment: 1 },
                        updatedAt: new Date()
                    }
                });

                const allCurrentOrdersInReceipt = await tx.order.findMany({
                    where: { receiptNumber },
                    include: { 
                        payments: { include: { financialRecords: true } },
                        brand: { select: { name: true } }
                    }
                });

                const clientAccount = await tx.clientAccount.findUnique({ where: { clientId: dto.clientId } });
                if (!clientAccount) throw new Error('Cuenta de cliente no encontrada');
                
                const mainClient = await tx.client.findUnique({ where: { id: dto.clientId } });
                const clientDoc = mainClient?.identificationNumber || 'S/N';
                const clientName = mainClient?.firstName.trim() || 'Cliente';

                const transactionGroupId = generateGroupId();
                const bankId = dto.bankAccountId || (await tx.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } }))?.id;

                // 2. REVERSAL LOGIC: Clean Slate for the entire receipt
                let totalWalletRefund = 0;

                for (const order of allCurrentOrdersInReceipt) {
                    for (const payment of order.payments) {
                        // a. Accumulate Wallet Refund total (to be applied as net at the end)
                        if (payment.method === 'BILLETERA_VIRTUAL') {
                            totalWalletRefund += Number(payment.amount);
                            console.log(`[BatchUpdate] Accumulating old wallet payment: ${payment.amount}, current total: ${totalWalletRefund}`);
                        } else {
                            // Revert from bank accounts immediately
                            const records = await tx.financialRecord.findMany({ where: { orderPaymentId: payment.id } });
                            for (const fr of records) {
                                if (fr.bankAccountId) {
                                    await tx.bankAccount.update({
                                        where: { id: fr.bankAccountId },
                                        data: { currentBalance: { decrement: fr.amount }, version: { increment: 1 } }
                                    });
                                }
                            }
                        }
                        // b. Delete Financial Records & Payments
                        await tx.financialRecord.deleteMany({ where: { orderPaymentId: payment.id } });
                        await tx.orderPayment.delete({ where: { id: payment.id } });
                    }
                }

                // 3. APPLY DELETIONS
                if (dto.toDelete.length > 0) {
                    await tx.orderItem.deleteMany({ where: { orderId: { in: dto.toDelete } } });
                    await tx.order.deleteMany({ where: { id: { in: dto.toDelete } } });
                }

                // Identify effective parent for grouping
                const remainingOrders = await tx.order.findMany({ where: { receiptNumber } });
                let effectiveParentId = remainingOrders.find(o => !o.parentOrderId)?.id || remainingOrders[0]?.id;

                // 4. APPLY UPDATES AND NEW PAYMENTS (One per order as requested)
                // Prepare Order Number Sequence for new items
                let nextOrderNumber = 0;
                let orderPrefix = `PD-${new Date().getFullYear()}-`;
                
                const lastOrder = await tx.order.findFirst({ orderBy: { createdAt: 'desc' } });
                if (lastOrder && lastOrder.orderNumber && lastOrder.orderNumber.includes('-')) {
                    const lastParts = lastOrder.orderNumber.split('-');
                    const lastNum = parseInt(lastParts[lastParts.length - 1]);
                    if (!isNaN(lastNum)) nextOrderNumber = lastNum + 1;
                } else {
                    nextOrderNumber = 1;
                }

                for (const orderDto of dto.orders) {
                    let orderId = orderDto.id;
                    const isNew = !orderId;
                    const wantedDeposit = Number(orderDto.deposit || 0);

                    if (!isNew) {
                        // Pre-verify existence
                        const existing = await tx.order.findUnique({ where: { id: orderId } });
                        if (!existing) throw new Error(`Pedido ${orderId} no existe para actualizar.`);
                        
                        await tx.order.update({
                            where: { id: orderId },
                            data: {
                                brandId: orderDto.brandId,
                                total: Number(orderDto.total),
                                paymentMethod: dto.paymentMethod,
                                bankAccountId: bankId,
                                status: orderDto.status as any,
                                updatedAt: new Date(),
                                version: { increment: 1 }
                            }
                        });
                    } else {
                        orderId = crypto.randomUUID();
                        let actualOrderNumber = orderDto.orderNumber;
                        if (!actualOrderNumber) {
                            actualOrderNumber = `${orderPrefix}${String(nextOrderNumber).padStart(3, '0')}`;
                            nextOrderNumber++;
                        }

                        await tx.order.create({
                            data: {
                                id: orderId,
                                receiptId: receipt.id,
                                receiptNumber,
                                clientId: dto.clientId,
                                clientName,
                                salesChannel: dto.salesChannel,
                                brandId: orderDto.brandId,
                                brandName: orderDto.brandName,
                                total: Number(orderDto.total),
                                paymentMethod: dto.paymentMethod,
                                bankAccountId: bankId,
                                type: orderDto.type,
                                orderNumber: actualOrderNumber,
                                parentOrderId: effectiveParentId || undefined,
                                status: orderDto.status || 'POR_RECIBIR',
                                possibleDeliveryDate: orderDto.possibleDeliveryDate,
                                transactionDate: dto.transactionDate,
                                createdAt: new Date(),
                                createdByName: updatedBy
                            }
                        });
                        if (!effectiveParentId) effectiveParentId = orderId;
                    }

                    // Register NEW Payment for this order
                    if (wantedDeposit > 0) {
                        const paymentId = crypto.randomUUID();
                        const payMethod = dto.paymentMethod;

                        // Create Payment Record
                        await tx.orderPayment.create({
                            data: {
                                id: paymentId,
                                orderId,
                                amount: wantedDeposit,
                                method: payMethod,
                                receiptNumber: `AB-${crypto.randomUUID().slice(0, 8)}`,
                                createdAt: new Date()
                            }
                        });

                        const userNotes = dto.notes || orderDto.notes || "";
                        const systemDetail = `Abono corregido | Marca: ${orderDto.brandName || '—'} | Orden: ${receiptNumber} | Pedido: ${orderDto.orderNumber || '—'}`;
                        const orderSummary = { receiptNumber, orderNumber: orderDto.orderNumber, brandName: orderDto.brandName };
                        
                        if (payMethod === 'BILLETERA_VIRTUAL') {
                            // Accumulate wallet expense
                            totalWalletRefund -= wantedDeposit;
                            console.log(`[BatchUpdate] Deducting new wallet payment: ${wantedDeposit}, current total: ${totalWalletRefund}`);
                            
                            const bankAcc = await tx.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } });
                            const bankIdUsed = bankAcc?.id || bankId;

                            // @ts-ignore
                            await tx.financialRecord.create({
                                data: {
                                    id: crypto.randomUUID(),
                                    type: 'PAYMENT',
                                    source: 'WALLET',
                                    movementType: 'INTERNAL',
                                    fromAccountType: 'WALLET',
                                    toAccountType: 'INTERNAL',
                                    amount: wantedDeposit,
                                    date: new Date(),
                                    client: { connect: { id: dto.clientId } },
                                    clientName,
                                    clientDocument: clientDoc,
                                    bankAccount: { connect: { id: bankIdUsed || 'cash-account-1' } },
                                    referenceNumber: `WAL-UPD-${crypto.randomUUID().slice(0, 12)}`,
                                    transactionGroupId,
                                    order: { connect: { id: orderId } },
                                    orderPayment: { connect: { id: paymentId } },
                                    createdBy: updatedBy,
                                    notes: buildNotesJSON({
                                        title: 'USO_BILLETERA',
                                        module: 'ORDERS',
                                        clientDoc,
                                        orders: [orderSummary],
                                        description: userNotes,
                                        extra: systemDetail
                                    })
                                } as any
                            });
                        } else {
                            // Cash / Bank
                            if (!bankId) throw new Error('Cuenta de caja no encontrada');
                            const bankAcc = await tx.bankAccount.findUnique({ where: { id: bankId } });
                            const bankBalBefore = Number(bankAcc?.currentBalance || 0);

                            await tx.bankAccount.update({
                                where: { id: bankId },
                                data: { currentBalance: { increment: wantedDeposit }, version: { increment: 1 } }
                            });

                            // @ts-ignore
                            await tx.financialRecord.create({
                                data: {
                                    id: crypto.randomUUID(),
                                    type: 'PAYMENT',
                                    source: 'ORDER_PAYMENT',
                                    movementType: 'INCOME',
                                    fromAccountType: 'EXTERNAL',
                                    toAccountType: 'CASH',
                                    amount: wantedDeposit,
                                    date: new Date(),
                                    client: { connect: { id: dto.clientId } },
                                    clientName,
                                    clientDocument: clientDoc,
                                    bankAccount: { connect: { id: bankId } },
                                    referenceNumber: `FIN-UPD-${crypto.randomUUID().slice(0, 12)}`,
                                    transactionGroupId,
                                    order: { connect: { id: orderId } },
                                    orderPayment: { connect: { id: paymentId } },
                                    createdBy: updatedBy,
                                    notes: buildNotesJSON({
                                        title: cardTitleFromMethod(payMethod),
                                        module: 'ORDERS',
                                        clientDoc,
                                        orders: [orderSummary],
                                        description: userNotes,
                                        extra: systemDetail
                                    })
                                } as any
                            });
                        }
                    }
                }

                // 5. APPLY NET WALLET DELTA
                console.log(`[BatchUpdate] FINAL WALLET DELTA: ${totalWalletRefund}`);
                if (Math.abs(totalWalletRefund) > 0.001) {
                    const currentAcc = await tx.clientAccount.findUnique({ where: { clientId: dto.clientId } });
                    if (!currentAcc) throw new Error('Cuenta de cliente no encontrada para sincronización final');

                    if (totalWalletRefund > 0) {
                        // NET REFUND: Create a single credit record
                        await tx.clientCredit.create({
                            data: {
                                clientAccountId: currentAcc.id,
                                amount: totalWalletRefund,
                                remainingAmount: totalWalletRefund,
                                originTransactionId: `REF-BATCH-${receiptNumber}-${crypto.randomUUID().slice(0, 4)}`,
                                status: 'AVAILABLE',
                                createdAt: new Date()
                            }
                        });
                        await tx.clientAccount.update({
                            where: { id: currentAcc.id },
                            data: { totalCreditAvailable: { increment: totalWalletRefund }, version: { increment: 1 } }
                        });
                    } else {
                        // NET EXPENSE: Deduct from balance and consume credits FIFO
                        const expenseAmount = Math.abs(totalWalletRefund);
                        
                        if (Number(currentAcc.totalCreditAvailable) < expenseAmount) {
                            throw new Error(`Saldo insuficiente en billetera para cubrir el ajuste del recibo. Necesario: $${expenseAmount}, Disponible: $${currentAcc.totalCreditAvailable}`);
                        }

                        const availableCredits = await tx.clientCredit.findMany({
                            where: { clientAccountId: currentAcc.id, status: 'AVAILABLE' },
                            orderBy: { createdAt: 'asc' }
                        });

                        let remaining = expenseAmount;
                        for (const credit of availableCredits) {
                            if (remaining <= 0) break;
                            const subtract = Math.min(Number(credit.remainingAmount), remaining);
                            const newRemaining = Number(credit.remainingAmount) - subtract;
                            await tx.clientCredit.update({
                                where: { id: credit.id },
                                data: {
                                    remainingAmount: newRemaining,
                                    status: newRemaining <= 0.01 ? 'USED' : 'AVAILABLE',
                                    usedAt: newRemaining <= 0.01 ? new Date() : undefined
                                }
                            });
                            remaining -= subtract;
                        }

                        await tx.clientAccount.update({
                            where: { id: currentAcc.id },
                            data: { totalCreditAvailable: { decrement: expenseAmount }, version: { increment: 1 } }
                        });
                    }
                }

                return Result.ok({ success: true });
            });
        } catch (err: any) {
            console.error('[BatchUpdateOrders] Error:', err);
            return Result.fail(err.message || 'Error al actualizar el lote de pedidos');
        }
    }
}
