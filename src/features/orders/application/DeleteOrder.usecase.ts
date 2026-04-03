import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class DeleteOrderUseCase {
    constructor() { }

    async execute(orderId: string, cascadeReceipt: boolean = false): Promise<Result<void>> {
        try {
            return await prisma.$transaction(async (tx) => {
                // 1. Validaciones iniciales del pedido principal
                const mainOrder = await tx.order.findUnique({
                    where: { id: orderId }
                });

                if (!mainOrder) {
                    return Result.fail('Pedido no encontrado');
                }

                // Determinar qué pedidos vamos a borrar
                let ordersToDeleteIds = [orderId];
                if (cascadeReceipt) {
                    if (mainOrder.receiptId) {
                        const relatedOrders = await tx.order.findMany({
                            where: { receiptId: mainOrder.receiptId },
                            select: { id: true, status: true }
                        });
                        if (relatedOrders.some(o => o.status === 'ENTREGADO')) {
                            throw new Error('No se puede eliminar el recibo porque contiene pedidos que ya han sido entregados.');
                        }
                        ordersToDeleteIds = relatedOrders.map(o => o.id);
                    } else if (mainOrder.receiptNumber) {
                        // Para cambios que a veces no tienen receiptId formal pero sí receiptNumber agrupado
                        const relatedOrders = await tx.order.findMany({
                            where: { receiptNumber: mainOrder.receiptNumber },
                            select: { id: true, status: true }
                        });
                        if (relatedOrders.some(o => o.status === 'ENTREGADO')) {
                            throw new Error('No se puede eliminar la guía porque contiene cambios que ya han sido entregados.');
                        }
                        ordersToDeleteIds = relatedOrders.map(o => o.id);
                    }
                }

                // REGLA: No borrar pedidos de periodos cerrados (aplicar a todos)
                const lastClosure = await tx.cashClosure.findFirst({
                    orderBy: { toDate: 'desc' }
                });

                // 2. Procesar cada pedido
                for (const idToDelete of ordersToDeleteIds) {
                    const order = await tx.order.findUnique({
                        where: { id: idToDelete },
                        include: {
                            payments: true,
                            financialRecords: true,
                            client: {
                                include: {
                                    clientAccount: true
                                }
                            }
                        }
                    });

                    if (!order) continue;

                    // Validar estado e integridad de cada pedido
                    const currentPayments = order.payments || [];
                    
                    // Si es un CAMBIO, permitimos borrar aunque esté RECIBIDO_EN_BODEGA, 
                    // a menos que el usuario lo prohíba explícitamente.
                    // Pero la regla general de hasRealMovement sigue aplicando para pedidos normales.
                    const isExchange = order.type === 'CAMBIO' || order.sourceOrderId !== null || order.receiptNumber?.includes('CAM');
                    
                    const hasRealMovement = !isExchange && (order.status !== 'POR_RECIBIR' || currentPayments.length > 2 || (currentPayments.length > 1 && !currentPayments.some(p => p.method === 'CREDITO_CLIENTE')));

                    if (hasRealMovement) {
                        let reason = `No se puede eliminar el pedido ${order.orderNumber || order.id} porque ya tiene movimientos procesados.`;
                        if (order.status === 'ENTREGADO') reason = `No se puede eliminar el pedido de ${order.brandId} que ya fue entregado.`;
                        if (order.status === 'RECIBIDO_EN_BODEGA') reason = `No se puede eliminar el pedido de ${order.brandId} que ya fue receptado.`;
                        
                        throw new Error(reason);
                    }
                    
                    // Si es un cambio ENTREGADO, bloqueamos siempre
                    if (order.status === 'ENTREGADO') {
                        throw new Error(`No se puede eliminar el cambio ${order.orderNumber} porque ya fue entregado.`);
                    }

                    if (lastClosure && order.transactionDate <= lastClosure.toDate) {
                        throw new Error(`No se puede eliminar el pedido ${order.orderNumber || order.id} porque pertenece a un periodo de caja cerrado.`);
                    }

                    // --- REVERSIÓN DE CAMBIO (SOURCE ORDER) ---
                    if (order.sourceOrderId) {
                        await tx.order.update({
                            where: { id: order.sourceOrderId },
                            data: { status: 'ENTREGADO' }
                        });
                    }

                    // --- REVERSIÓN FINANCIERA (Bancos) ---
                    const financialRecords = order.financialRecords;
                    for (const fr of financialRecords) {
                        if (fr.bankAccountId) {
                            if (fr.movementType === 'INCOME') {
                                await tx.bankAccount.update({
                                    where: { id: fr.bankAccountId },
                                    data: { currentBalance: { decrement: fr.amount }, version: { increment: 1 } }
                                });
                            } else if (fr.movementType === 'EXPENSE') {
                                await tx.bankAccount.update({
                                    where: { id: fr.bankAccountId },
                                    data: { currentBalance: { increment: fr.amount }, version: { increment: 1 } }
                                });
                            }
                        }
                    }

                    // --- REVERSIÓN DE SALDOS A FAVOR (GENERADOS) ---
                    const generatedCredits = await tx.clientCredit.findMany({
                        where: { originOrderId: idToDelete, status: 'AVAILABLE' }
                    });

                    for (const credit of generatedCredits) {
                        if (Number(credit.remainingAmount) < Number(credit.amount) - 0.01) {
                            throw new Error(`Saldo a favor del pedido ${order.orderNumber} ya fue utilizado.`);
                        }

                        if (order.client.clientAccount) {
                            await tx.clientAccount.update({
                                where: { id: order.client.clientAccount.id },
                                data: { totalCreditAvailable: { decrement: credit.remainingAmount }, version: { increment: 1 } }
                            });
                        }
                        await tx.clientCredit.delete({ where: { id: credit.id } });
                    }

                    // --- REVERSIÓN DE PAGOS (RECIBIDOS/CONSUMIDOS) ---
                    for (const payment of order.payments) {
                        if (payment.method === 'BILLETERA_VIRTUAL') {
                            if (order.client.clientAccount) {
                                await tx.clientAccount.update({
                                    where: { id: order.client.clientAccount.id },
                                    data: { totalCreditAvailable: { increment: payment.amount }, version: { increment: 1 } }
                                });
                            }
                        }
                    }

                    // --- REVERSIÓN DE PUNTOS ---
                    const applications = await tx.rewardApplication.findMany({ where: { orderId: idToDelete } });
                    for (const app of applications) {
                        if (order.client.clientAccount) {
                            await tx.clientAccount.update({
                                where: { id: order.client.clientAccount.id },
                                data: { totalRewardPoints: { decrement: app.pointsEarned }, version: { increment: 1 } }
                            });
                        }
                    }

                    // --- LIMPIEZA ---
                    await tx.financialRecord.deleteMany({ where: { orderId: idToDelete } });
                    await tx.inventoryMovement.deleteMany({ where: { orderId: idToDelete } });
                    await tx.rewardApplication.deleteMany({ where: { orderId: idToDelete } });
                    await tx.orderItem.deleteMany({ where: { orderId: idToDelete } });
                    await tx.orderPayment.deleteMany({ where: { id: { in: order.payments.map(p => p.id) } } });
                    await tx.call.updateMany({ where: { orderId: idToDelete }, data: { orderId: null } });
                    await tx.order.delete({ where: { id: idToDelete } });
                }

                // Si borramos todos los pedidos de un recibo, opcionalmente borrar el OrderReceipt
                if (cascadeReceipt && mainOrder.receiptId) {
                    const remaining = await tx.order.count({ where: { receiptId: mainOrder.receiptId } });
                    if (remaining === 0) {
                        await tx.orderReceipt.delete({ where: { id: mainOrder.receiptId } });
                    }
                }

                return Result.ok();
            }, {
                timeout: 30000 // Aumentar timeout para borrados masivos
            });
        } catch (error) {
            console.error('DeleteOrderUseCase Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Error al eliminar el pedido');
        }
    }
}
