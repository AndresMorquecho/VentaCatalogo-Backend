import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';
import { OrderStatus } from '../domain/Order.entity';

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
                console.log('[BatchUpdateOrdersUseCase] Last closure:', lastClosure);

                if (lastClosure && new Date(dto.transactionDate) <= lastClosure.toDate) {
                    throw new Error('No se puede procesar el recibo: El periodo de caja para esta fecha ya está cerrado.');
                }

                // Obtener el cliente una sola vez al inicio
                const client = await tx.client.findUnique({ where: { id: dto.clientId } });
                const clientName = client?.firstName || 'Desconocido';
                console.log('[BatchUpdateOrdersUseCase] Client:', clientName);

                // 1. Handle Deletions
                console.log('[BatchUpdateOrdersUseCase] Processing deletions:', dto.toDelete);
                for (const idToDelete of dto.toDelete) {
                    const order = await tx.order.findUnique({
                        where: { id: idToDelete },
                        include: { payments: true, brand: true, childOrders: true }
                    });

                    if (order) {
                        // CHECK: Cannot delete if it has movement or is processed
                        const currentPayments = order.payments || [];
                        const hasRealMovement = order.status !== 'POR_RECIBIR' || currentPayments.length > 2 || (currentPayments.length > 1 && !currentPayments.some(p => p.method === 'CREDITO_CLIENTE'));
                        
                        if (hasRealMovement) {
                            throw new Error(`No se puede eliminar la marca ${order.brand.name}: Ya tiene movimientos procesados (recepción o abonos adicionales).`);
                        }

                        // Handle orphan children if balance/receipt logic requires it
                        // (Usually child orders are part of the same receipt group)
                        if (order.childOrders && order.childOrders.length > 0) {
                            // If we delete the parent, we need to handle children.
                            // However, in a batch update, the children should be either in 'toDelete' or in 'orders' list.
                            // If they are in 'orders' list, they will be updated later with a new parentId.
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

                        // Clean up child dependencies manually before deleting parent to avoid FK issues
                        await tx.order.updateMany({
                            where: { parentOrderId: idToDelete },
                            data: { parentOrderId: null }
                        });

                        await tx.order.delete({ where: { id: idToDelete } });
                    }
                }

                // 2. Handle Upserts (Update or Create)
                console.log('[BatchUpdateOrdersUseCase] Processing orders:', dto.orders.length);
                let parentId: string | null = null;
                const processedOrders = [];

                for (let i = 0; i < dto.orders.length; i++) {
                    const orderItem = dto.orders[i];
                    console.log(`[BatchUpdateOrdersUseCase] Processing order ${i + 1}/${dto.orders.length}:`, orderItem.id ? `UPDATE ${orderItem.id}` : 'CREATE');

                    if (orderItem.id) {
                        // UPDATE EXISTING
                        const existing = await tx.order.findUnique({
                            where: { id: orderItem.id },
                            include: { items: true, payments: true, brand: true }
                        });

                        if (existing) {
                            // CHECK: Cannot update if it has movement
                            const currentPayments = existing.payments || [];
                            const hasRealMovement = existing.status !== 'POR_RECIBIR' || currentPayments.length > 2 || (currentPayments.length > 1 && !currentPayments.some(p => p.method === 'CREDITO_CLIENTE'));
                            
                            if (hasRealMovement) {
                                throw new Error(`No se puede editar la marca ${existing.brand.name}: Ya tiene movimientos procesados (recepción o abonos adicionales).`);
                            }
                            // Update Order fields - Always update base fields if they changed
                            const updated: any = await tx.order.update({
                                where: { id: orderItem.id },
                                data: {
                                    orderNumber: orderItem.orderNumber,
                                    type: orderItem.type,
                                    total: orderItem.total,
                                    possibleDeliveryDate: orderItem.possibleDeliveryDate ? new Date(orderItem.possibleDeliveryDate) : existing.possibleDeliveryDate,
                                    // Other sync fields
                                    receiptNumber: dto.receiptNumber,
                                    clientId: dto.clientId,
                                    salesChannel: dto.salesChannel,
                                    notes: dto.notes,
                                    transactionDate: dto.transactionDate ? new Date(dto.transactionDate) : existing.transactionDate,
                                    createdAt: dto.createdAt ? new Date(dto.createdAt) : existing.createdAt,
                                    updatedAt: new Date(),
                                    parentOrderId: i > 0 ? parentId : null
                                }
                            });

                            // Update payment if deposit changed and there is only one payment
                            if (orderItem.deposit !== undefined) {
                                const currentDeposit = existing.payments.length > 0
                                    ? Number(existing.payments.reduce((sum, p) => sum + Number(p.amount), 0))
                                    : 0;

                                const diff = orderItem.deposit - currentDeposit;

                                if (Math.abs(diff) > 0.01) {
                                    // If it has multiple payments, we don't allow changing the total deposit sum via edit
                                    if (existing.payments.length > 1) {
                                        throw new Error(`No se puede ajustar el abono de ${existing.brand.name}: Ya existen abonos posteriores.`);
                                    }

                                    if (existing.payments.length === 1) {
                                        const payment = existing.payments[0];
                                        await tx.orderPayment.update({
                                            where: { id: payment.id },
                                            data: { amount: orderItem.deposit }
                                        });

                                        if (existing.bankAccountId) {
                                            await tx.bankAccount.update({
                                                where: { id: existing.bankAccountId },
                                                data: { currentBalance: { increment: diff } }
                                            });
                                        }

                                        // Update Financial Record
                                        await tx.financialRecord.updateMany({
                                            where: { orderId: existing.id, amount: payment.amount, type: 'PAYMENT' },
                                            data: { amount: orderItem.deposit }
                                        });
                                    } else if (orderItem.deposit > 0) {
                                        // Case where it had 0 deposit and now it has one
                                        await tx.orderPayment.create({
                                            data: {
                                                id: crypto.randomUUID(),
                                                orderId: existing.id,
                                                amount: orderItem.deposit,
                                                method: dto.paymentMethod,
                                                receiptNumber: `REC-ABO-${Date.now().toString().slice(-6)}`,
                                                description: 'Abono inicial (Edit)'
                                            }
                                        });
                                        // ... update bank and financial record for new payment ...
                                        if (dto.bankAccountId) {
                                            await tx.bankAccount.update({
                                                where: { id: dto.bankAccountId },
                                                data: { currentBalance: { increment: orderItem.deposit } }
                                            });
                                            await tx.financialRecord.create({
                                                data: {
                                                    type: 'PAYMENT',
                                                    source: 'ORDER_PAYMENT',
                                                    movementType: 'INCOME',
                                                    referenceNumber: `REF-EDIT-${Date.now()}`,
                                                    amount: orderItem.deposit,
                                                    date: new Date(),
                                                    clientId: dto.clientId,
                                                    clientName: clientName,
                                                    orderId: existing.id,
                                                    createdBy: updatedBy,
                                                    notes: `Abono inicial editado ${dto.receiptNumber}`,
                                                    bankAccountId: dto.bankAccountId,
                                                    paymentMethod: dto.paymentMethod,
                                                    version: 1
                                                }
                                            });
                                        }
                                    }
                                }
                            }

                            // Sync OrderItems (Delete and re-create for simplicity in single-item logic)
                            await tx.orderItem.deleteMany({ where: { orderId: orderItem.id } });
                            await tx.orderItem.create({
                                data: {
                                    id: crypto.randomUUID(),
                                    orderId: orderItem.id,
                                    productName: orderItem.brandName,
                                    quantity: orderItem.quantity || 1,
                                    unitPrice: orderItem.quantity > 0 ? orderItem.total / orderItem.quantity : orderItem.total,
                                    brandId: orderItem.brandId,
                                    brandName: orderItem.brandName
                                }
                            });

                            if (i === 0) parentId = updated.id;
                            processedOrders.push(updated);
                        }
                    } else {
                        // CREATE NEW (Added during Edit)
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
                                createdAt: dto.createdAt,
                                version: 1,
                                items: {
                                    create: [{
                                        id: crypto.randomUUID(),
                                        productName: orderItem.brandName,
                                        quantity: orderItem.quantity || 1,
                                        unitPrice: orderItem.quantity > 0 ? orderItem.total / orderItem.quantity : orderItem.total,
                                        brandId: orderItem.brandId,
                                        brandName: orderItem.brandName
                                    }]
                                }
                            }
                        });

                        // If it has deposit, create payment
                        if (orderItem.deposit > 0) {
                            // Initial Payment creation logic (simplified for batch)
                            await tx.orderPayment.create({
                                data: {
                                    id: crypto.randomUUID(),
                                    orderId,
                                    amount: orderItem.deposit,
                                    method: dto.paymentMethod,
                                    receiptNumber: `REC-ABO-${Date.now().toString().slice(-6)}`,
                                    description: 'Abono inicial (Edit)'
                                }
                            });

                            if (dto.bankAccountId) {
                                await tx.bankAccount.update({
                                    where: { id: dto.bankAccountId },
                                    data: { currentBalance: { increment: orderItem.deposit } }
                                });

                                await tx.financialRecord.create({
                                    data: {
                                        type: 'PAYMENT',
                                        source: 'ORDER_PAYMENT',
                                        movementType: 'INCOME',
                                        referenceNumber: `REF-EDIT-${Date.now()}`,
                                        amount: orderItem.deposit,
                                        date: new Date(),
                                        clientId: dto.clientId,
                                        clientName: clientName,
                                        orderId,
                                        createdBy: updatedBy,
                                        notes: `Abono inicial editado ${dto.receiptNumber}`,
                                        bankAccountId: dto.bankAccountId,
                                        paymentMethod: dto.paymentMethod,
                                        version: 1
                                    }
                                });
                            }
                        }

                        processedOrders.push(created);
                    }
                }

                console.log('[BatchUpdateOrdersUseCase] Transaction completed successfully. Processed orders:', processedOrders.length);
                return processedOrders;
            }, {
                maxWait: 10000, // 10 segundos máximo de espera
                timeout: 30000, // 30 segundos de timeout
            });

            console.log('[BatchUpdateOrdersUseCase] Execution completed successfully');
            return Result.ok(result);
        } catch (error) {
            console.error('[BatchUpdateOrdersUseCase] Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Batch update failed');
        }
    }
}
