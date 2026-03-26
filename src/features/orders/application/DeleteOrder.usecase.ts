import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class DeleteOrderUseCase {
    constructor() { }

    async execute(orderId: string): Promise<Result<void>> {
        try {
            return await prisma.$transaction(async (tx) => {
                // 1. Validaciones de Integridad
                const order = await tx.order.findUnique({
                    where: { id: orderId },
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

                if (!order) {
                    return Result.fail('Pedido no encontrado');
                }

                // REGLA: Solo se pueden eliminar pedidos en estado 'POR_RECIBIR' y sin abonos adicionales (máximo 2 si uno es crédito)
                const currentPayments = order.payments || [];
                const hasRealMovement = order.status !== 'POR_RECIBIR' || currentPayments.length > 2 || (currentPayments.length > 1 && !currentPayments.some(p => p.method === 'CREDITO_CLIENTE'));

                if (hasRealMovement) {
                    let reason = 'No se puede eliminar un pedido que ya tiene movimientos procesados (recepción o abonos adicionales).';
                    if (order.status === 'ENTREGADO') reason = 'No se puede eliminar un pedido que ya ha sido entregado. Realice una devolución.';
                    if (order.status === 'RECIBIDO_EN_BODEGA') reason = 'No se puede eliminar un pedido que ya ha sido receptado en bodega.';
                    if (hasRealMovement && order.status === 'POR_RECIBIR') reason = 'No se puede eliminar un pedido que ya tiene abonos adicionales vinculados.';
                    
                    return Result.fail(reason);
                }

                // REGLA: No borrar pedidos de periodos cerrados
                const lastClosure = await tx.cashClosure.findFirst({
                    orderBy: { toDate: 'desc' }
                });

                if (lastClosure && order.transactionDate <= lastClosure.toDate) {
                    return Result.fail('No se puede eliminar un pedido de un periodo de caja ya cerrado.');
                }

                // 2. REVERSIÓN FINANCIERA (Bancos)
                const financialRecords = order.financialRecords;
                for (const fr of financialRecords) {
                    if (fr.bankAccountId) {
                        if (fr.movementType === 'INCOME') {
                            await tx.bankAccount.update({
                                where: { id: fr.bankAccountId },
                                data: {
                                    currentBalance: { decrement: fr.amount },
                                    version: { increment: 1 }
                                }
                            });
                        } else if (fr.movementType === 'EXPENSE') {
                            await tx.bankAccount.update({
                                where: { id: fr.bankAccountId },
                                data: {
                                    currentBalance: { increment: fr.amount },
                                    version: { increment: 1 }
                                }
                            });
                        }
                    }
                }

                // 3. REVERSIÓN DE SALDOS A FAVOR — Solo créditos DISPONIBLES vinculados a este pedido.
                // Si ya se revirtió la recepción, estos créditos ya no existen → sin problema.
                const generatedCredits = await tx.clientCredit.findMany({
                    where: {
                        originOrderId: orderId,
                        status: 'AVAILABLE'
                    }
                });

                for (const credit of generatedCredits) {
                    // Bloquear si fue parcialmente consumido
                    if (Number(credit.remainingAmount) < Number(credit.amount) - 0.01) {
                        throw new Error(
                            `No se puede eliminar el pedido porque el saldo a favor ($${Number(credit.amount).toFixed(2)}) ` +
                            `ya fue utilizado parcialmente (disponible: $${Number(credit.remainingAmount).toFixed(2)}).`
                        );
                    }

                    if (order.client.clientAccount) {
                        await tx.clientAccount.update({
                            where: { id: order.client.clientAccount.id },
                            data: {
                                totalCreditAvailable: { decrement: credit.remainingAmount },
                                version: { increment: 1 }
                            }
                        });
                    }

                    await tx.clientCredit.delete({ where: { id: credit.id } });
                }

                // 4. REVERSIÓN DE PAGOS CON BILLETERA Y PUNTOS
                // Revertir abonos hechos con billetera virtual
                for (const payment of order.payments) {
                    if (payment.method === 'BILLETERA_VIRTUAL') {
                        if (order.client.clientAccount) {
                            await tx.clientAccount.update({
                                where: { id: order.client.clientAccount.id },
                                data: {
                                    totalCreditAvailable: { increment: payment.amount },
                                    version: { increment: 1 }
                                }
                            });
                        }
                    }
                }

                // Revertir puntos ganados
                const applications = await tx.rewardApplication.findMany({ 
                    where: { orderId: orderId } 
                });
                for (const app of applications) {
                    if (order.client.clientAccount) {
                        await tx.clientAccount.update({
                            where: { id: order.client.clientAccount.id },
                            data: {
                                totalRewardPoints: { decrement: app.pointsEarned },
                                version: { increment: 1 }
                            }
                        });
                    }
                }

                // 5. LIMPIEZA DE REGISTROS RELACIONADOS
                await tx.financialRecord.deleteMany({ where: { orderId: orderId } });
                await tx.inventoryMovement.deleteMany({ where: { orderId: orderId } });
                await tx.rewardApplication.deleteMany({ where: { orderId: orderId } });
                await tx.orderItem.deleteMany({ where: { orderId: orderId } });
                await tx.orderPayment.deleteMany({ where: { orderId: orderId } });
                await tx.call.updateMany({ where: { orderId: orderId }, data: { orderId: null } });

                // 5. ELIMINACIÓN FINAL DEL PEDIDO
                await tx.order.delete({ where: { id: orderId } });

                return Result.ok();
            });
        } catch (error) {
            console.error('DeleteOrderUseCase Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Error al eliminar el pedido');
        }
    }
}
