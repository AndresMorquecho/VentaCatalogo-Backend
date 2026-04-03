import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';
import { OrderStatus } from '../domain/Order.entity';
import crypto from 'crypto';

export interface BatchUpdateOrdersDTO {
    receiptNumber: string;
    clientId: string;
    salesChannel: string;
    createdAt: Date;
    paymentMethod: string;
    bankAccountId?: string;
    transactionDate: Date;
    notes?: string;
    toDelete: string[];
    creditAmount?: number;
    orders: Array<{
        id?: string;
        brandId: string;
        brandName: string;
        total: number;
        deposit: number;
        type: string;
        possibleDeliveryDate: Date;
        orderNumber?: string;
        quantity: number; // For item update
        sourceOrderId?: string;
        sourceOrderNumber?: string;
        sourceBrandName?: string;
        sourceQuantity?: number;
        sourceDescription?: string;
        description?: string;
        notes?: string;
    }>;
}

export class BatchUpdateOrdersUseCase {
    async execute(dto: BatchUpdateOrdersDTO, updatedBy: string): Promise<Result<any>> {
        console.log('[BatchUpdateOrdersUseCase] Starting execution with dto:', JSON.stringify(dto, null, 2));
        
        try {
            const result = await prisma.$transaction(async (tx) => {
                console.log('[BatchUpdateOrdersUseCase] Transaction started');
                
                // 0. Pre-check Cash Closure
                const lastClosure = await tx.cashClosure.findFirst({
                    orderBy: { toDate: 'desc' }
                });

                if (lastClosure && new Date(dto.transactionDate) <= lastClosure.toDate) {
                    throw new Error('No se puede procesar el recibo: El periodo de caja para esta fecha ya está cerrado.');
                }

                // Actualizar encabezado del recibo (OrderReceipt)
                await (tx as any).orderReceipt.update({
                    where: { receiptNumber: dto.receiptNumber },
                    data: {
                        salesChannel: dto.salesChannel,
                        transactionDate: dto.transactionDate,
                        paymentMethod: dto.paymentMethod,
                        bankAccountId: dto.bankAccountId || null,
                        notes: dto.notes,
                        version: { increment: 1 }
                    }
                });

                // Balance tracking maps to ensure sequentiality within the batch
                const accountBalancesMap = new Map<string, number>();
                let clientWalletRunningBal: number | null = null;

                // Obtener el cliente una sola vez al inicio
                const client = await tx.client.findUnique({ where: { id: dto.clientId } });
                const clientDoc = client?.identificationNumber || '—';
                const clientName = client?.firstName || 'Desconocido';

                // 1. Handle Deletions
                for (const idToDelete of dto.toDelete) {
                    const order = await tx.order.findUnique({
                        where: { id: idToDelete },
                        include: { payments: true, brand: true, childOrders: true }
                    });

                    if (order) {
                        const currentPayments = order.payments || [];
                        const hasRealMovement = order.status !== 'POR_RECIBIR' || currentPayments.length > 2 || (currentPayments.length > 1 && !currentPayments.some(p => p.method === 'CREDITO_CLIENTE'));
                        
                        if (hasRealMovement) {
                            throw new Error(`No se puede eliminar la marca ${order.brand.name}: Ya tiene movimientos procesados (recepción o abonos adicionales).`);
                        }

                        // Revert payments for this specific order item
                        for (const payment of order.payments) {
                            if (Number(payment.amount) > 0) {
                                // Revert bank balance
                                if (order.bankAccountId) {
                                    await tx.bankAccount.update({
                                        where: { id: order.bankAccountId },
                                        data: { currentBalance: { decrement: payment.amount } }
                                    });
                                }
                                // Delete FinancialRecord
                                await tx.financialRecord.deleteMany({
                                    where: { orderId: order.id, amount: payment.amount, type: 'PAYMENT' }
                                });
                            }
                        }

                        // Delete relationships and the order itself
                        await tx.orderItem.deleteMany({ where: { orderId: idToDelete } });
                        await tx.orderPayment.deleteMany({ where: { orderId: idToDelete } });
                        await tx.rewardApplication.deleteMany({ where: { orderId: idToDelete } });
                        await tx.inventoryMovement.deleteMany({ where: { orderId: idToDelete } });

                        await tx.order.updateMany({
                            where: { parentOrderId: idToDelete },
                            data: { parentOrderId: null }
                        });

                        await tx.order.delete({ where: { id: idToDelete } });
                    }
                }

                // 2. Handle Upserts (Update or Create)
                let parentId: string | null = null;
                const processedOrders = [];

                for (let i = 0; i < dto.orders.length; i++) {
                    const orderItem = dto.orders[i];

                    if (orderItem.id) {
                        // UPDATE EXISTING
                        const existing: any = await tx.order.findUnique({
                            where: { id: orderItem.id },
                            include: { items: true, payments: true, brand: true }
                        });

                        if (existing) {
                            const currentPayments = existing.payments || [];
                            const hasRealMovement = existing.status !== 'POR_RECIBIR' || currentPayments.length > 2 || (currentPayments.length > 1 && !currentPayments.some((p: any) => p.method === 'CREDITO_CLIENTE'));
                            
                            if (hasRealMovement) {
                                throw new Error(`No se puede editar la marca ${existing.brand.name}: Ya tiene movimientos procesados (recepción o abonos adicionales).`);
                            }

                            const updated: any = await tx.order.update({
                                where: { id: orderItem.id },
                                data: {
                                    orderNumber: orderItem.orderNumber,
                                    type: orderItem.type,
                                    total: orderItem.total,
                                    possibleDeliveryDate: orderItem.possibleDeliveryDate ? new Date(orderItem.possibleDeliveryDate) : existing.possibleDeliveryDate,
                                    receiptNumber: dto.receiptNumber,
                                    clientId: dto.clientId,
                                    salesChannel: dto.salesChannel,
                                    notes: dto.notes,
                                    transactionDate: dto.transactionDate ? new Date(dto.transactionDate) : existing.transactionDate,
                                    createdAt: dto.createdAt ? new Date(dto.createdAt) : existing.createdAt,
                                    updatedAt: new Date(),
                                    parentOrderId: i > 0 ? parentId : null,
                                    orderNumber: orderItem.orderNumber ?? existing.orderNumber, // Added to ensure CAM prefix is saved
                                    sourceOrderId: orderItem.sourceOrderId ?? existing.sourceOrderId,
                                    sourceOrderNumber: orderItem.sourceOrderNumber ?? existing.sourceOrderNumber,
                                    sourceBrandName: orderItem.sourceBrandName ?? existing.sourceBrandName,
                                    sourceQuantity: orderItem.sourceQuantity ?? existing.sourceQuantity,
                                    sourceDescription: orderItem.sourceDescription ?? existing.sourceDescription,
                                    description: orderItem.description ?? existing.description,
                                    bankAccountId: dto.bankAccountId ?? existing.bankAccountId,
                                    paymentMethod: dto.paymentMethod ?? existing.paymentMethod
                                } as any
                            });

                            // Update payment if deposit changed and there is only one payment
                            if (orderItem.deposit !== undefined) {
                                const currentSum = Number(existing.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0));
                                const diff = orderItem.deposit - currentSum;

                                if (Math.abs(diff) > 0.01) {
                                    if (existing.payments.length > 1) {
                                        throw new Error(`No se puede ajustar el abono de ${existing.brand.name}: Ya existen abonos posteriores.`);
                                    }

                                    if (existing.payments.length === 1) {
                                        const payment = existing.payments[0];
                                        const oldBankId = existing.bankAccountId;
                                        const newBankId = dto.bankAccountId;

                                        // Update payment details
                                        await tx.orderPayment.update({
                                            where: { id: payment.id },
                                            data: { 
                                                amount: orderItem.deposit,
                                                method: dto.paymentMethod,
                                                bankAccountId: dto.bankAccountId
                                            }
                                        });

                                        // Balance correction if bank changed
                                        if (oldBankId !== newBankId) {
                                            if (oldBankId) {
                                                await tx.bankAccount.update({
                                                    where: { id: oldBankId },
                                                    data: { currentBalance: { decrement: Number(payment.amount) } }
                                                });
                                            }
                                            if (newBankId) {
                                                await tx.bankAccount.update({
                                                    where: { id: newBankId },
                                                    data: { currentBalance: { increment: orderItem.deposit } }
                                                });
                                            }
                                        } else if (newBankId && Math.abs(diff) > 0.01) {
                                            // Same bank, just amount changed
                                            await tx.bankAccount.update({
                                                where: { id: newBankId },
                                                data: { currentBalance: { increment: diff } }
                                            });
                                        }

                                        // Update Financial Record
                                        await tx.financialRecord.updateMany({
                                            where: { orderId: existing.id, orderPaymentId: payment.id, type: 'PAYMENT' },
                                            data: { 
                                                amount: orderItem.deposit,
                                                bankAccountId: dto.bankAccountId,
                                                paymentMethod: dto.paymentMethod
                                            }
                                        });
                                    } else if (orderItem.deposit > 0) {
                                        // Case where it had 0 deposit and now it has one
                                        const paymentId = crypto.randomUUID();
                                        await tx.orderPayment.create({
                                            data: {
                                                id: paymentId,
                                                orderId: existing.id,
                                                amount: orderItem.deposit,
                                                method: dto.paymentMethod,
                                                receiptNumber: `REC-ABO-${Date.now().toString().slice(-6)}`,
                                                description: 'Abono inicial (Edit)'
                                            }
                                        });

                                        if (dto.bankAccountId) {
                                            if (!accountBalancesMap.has(dto.bankAccountId)) {
                                                const acc = await tx.bankAccount.findUnique({
                                                    where: { id: dto.bankAccountId },
                                                    select: { currentBalance: true }
                                                });
                                                accountBalancesMap.set(dto.bankAccountId, Number(acc?.currentBalance || 0));
                                            }

                                            const balanceBefore = accountBalancesMap.get(dto.bankAccountId)!;
                                            const balanceAfter = balanceBefore + orderItem.deposit;
                                            accountBalancesMap.set(dto.bankAccountId, balanceAfter);

                                            await tx.bankAccount.update({
                                                where: { id: dto.bankAccountId },
                                                data: { currentBalance: { increment: orderItem.deposit } }
                                            });

                                            await tx.financialRecord.create({
                                                data: {
                                                    type: 'PAYMENT',
                                                    source: 'ORDER_PAYMENT',
                                                    movementType: 'INCOME',
                                                    fromAccountType: 'EXTERNAL',
                                                    toAccountType: 'CASH',
                                                    referenceNumber: `REF-EDIT-${Date.now()}-${i}`,
                                                    amount: orderItem.deposit,
                                                    date: new Date(),
                                                    clientId: dto.clientId,
                                                    clientName: clientName,
                                                    clientDocument: clientDoc,
                                                    orderId: existing.id,
                                                    orderPaymentId: paymentId,
                                                    createdBy: updatedBy,
                                                    notes: `Abono inicial editado | Orden: ${dto.receiptNumber} | Pedido: ${existing.orderNumber || '—'} | Marca: ${existing.brand?.name || '—'} | Tipo: ${existing.type?.toUpperCase()}`,
                                                    bankAccountId: dto.bankAccountId,
                                                    paymentMethod: dto.paymentMethod,
                                                    balanceBefore,
                                                    balanceAfter,
                                                    version: 1,
                                                    createdAt: new Date()
                                                }
                                            });
                                        }
                                    }
                                }
                            }

                            // Sync OrderItems
                            await tx.orderItem.deleteMany({ where: { orderId: orderItem.id } });
                            await tx.orderItem.create({
                                data: {
                                    id: crypto.randomUUID(),
                                    orderId: orderItem.id,
                                    productName: orderItem.brandName,
                                    quantity: orderItem.quantity || 1,
                                    unitPrice: orderItem.quantity > 0 ? (orderItem.total / orderItem.quantity) : orderItem.total,
                                    brandId: orderItem.brandId,
                                    brandName: orderItem.brandName
                                }
                            });

                            if (i === 0) parentId = updated.id;
                            processedOrders.push(updated);
                        }
                    } else {
                        // CREATE NEW
                        const orderId = crypto.randomUUID();
                        if (i === 0) parentId = orderId;

                        const created = await tx.order.create({
                            data: {
                                id: orderId,
                                receiptNumber: dto.receiptNumber,
                                clientId: dto.clientId,
                                clientName: clientName,
                                salesChannel: dto.salesChannel,
                                type: orderItem.type,
                                brandId: orderItem.brandId,
                                total: orderItem.total,
                                paymentMethod: dto.paymentMethod,
                                bankAccountId: dto.bankAccountId || null,
                                transactionDate: dto.transactionDate,
                                possibleDeliveryDate: orderItem.possibleDeliveryDate,
                                status: OrderStatus.POR_RECIBIR,
                                parentOrderId: i > 0 ? parentId : null,
                                notes: dto.notes,
                                createdByName: updatedBy,
                                orderNumber: orderItem.orderNumber,
                                createdAt: dto.createdAt,
                                version: 1,
                                sourceOrderId: orderItem.sourceOrderId,
                                sourceOrderNumber: orderItem.sourceOrderNumber,
                                sourceBrandName: orderItem.sourceBrandName,
                                sourceQuantity: orderItem.sourceQuantity,
                                sourceDescription: orderItem.sourceDescription,
                                description: orderItem.description,
                                items: {
                                    create: [{
                                        id: crypto.randomUUID(),
                                        productName: orderItem.brandName,
                                        quantity: orderItem.quantity || 1,
                                        unitPrice: orderItem.quantity > 0 ? (orderItem.total / orderItem.quantity) : orderItem.total,
                                        brandId: orderItem.brandId,
                                        brandName: orderItem.brandName
                                    }]
                                }
                            } as any
                        });

                        if (orderItem.deposit > 0) {
                            const paymentId = crypto.randomUUID();
                            await tx.orderPayment.create({
                                data: {
                                    id: paymentId,
                                    orderId,
                                    amount: orderItem.deposit,
                                    method: dto.paymentMethod,
                                    receiptNumber: `REC-ABO-${Date.now().toString().slice(-6)}`,
                                    description: 'Abono inicial (Nuevo pedido en recibo)'
                                }
                            });

                            if (dto.bankAccountId) {
                                if (!accountBalancesMap.has(dto.bankAccountId)) {
                                    const acc = await tx.bankAccount.findUnique({
                                        where: { id: dto.bankAccountId },
                                        select: { currentBalance: true }
                                    });
                                    accountBalancesMap.set(dto.bankAccountId, Number(acc?.currentBalance || 0));
                                }

                                const balanceBefore = accountBalancesMap.get(dto.bankAccountId)!;
                                const balanceAfter = balanceBefore + orderItem.deposit;
                                accountBalancesMap.set(dto.bankAccountId, balanceAfter);

                                await tx.bankAccount.update({
                                    where: { id: dto.bankAccountId },
                                    data: { currentBalance: { increment: orderItem.deposit } }
                                });

                                await tx.financialRecord.create({
                                    data: {
                                        type: 'PAYMENT',
                                        source: 'ORDER_PAYMENT',
                                        movementType: 'INCOME',
                                        fromAccountType: 'EXTERNAL',
                                        toAccountType: 'CASH',
                                        referenceNumber: `REF-ADD-${Date.now()}-${i}`,
                                        amount: orderItem.deposit,
                                        date: new Date(),
                                        clientId: dto.clientId,
                                        clientName: clientName,
                                        clientDocument: clientDoc,
                                        orderId,
                                        orderPaymentId: paymentId,
                                        createdBy: updatedBy,
                                        notes: `Pedido inicial agregado | Orden: ${dto.receiptNumber} | Pedido: ${orderItem.orderNumber || '—'} | Marca: ${orderItem.brandName} | Tipo: ${orderItem.type?.toUpperCase()}`,
                                        bankAccountId: dto.bankAccountId,
                                        paymentMethod: dto.paymentMethod,
                                        balanceBefore,
                                        balanceAfter,
                                        version: 1,
                                        createdAt: new Date()
                                    }
                                });
                            }
                        }
                        processedOrders.push(created);
                    }
                }

                return processedOrders;
            }, {
                timeout: 30000
            });

            return Result.ok(result);
        } catch (error: any) {
            console.error('[BatchUpdateOrdersUseCase] Error:', error);
            return Result.fail(error.message || 'Error al actualizar el recibo.');
        }
    }
}
