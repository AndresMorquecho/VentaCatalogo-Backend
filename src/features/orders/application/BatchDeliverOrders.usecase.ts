import { prisma } from '../../../lib/prisma';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientCreditBalance } from '../../../shared/utils/financialValidations';

export interface BatchDeliverOrdersDTO {
  orderIds: string[];
  payments?: {
    amount: number;
    bankAccountId?: string;
    paymentMethod: string;
    reference?: string;
  }[];
  deliveredByName?: string;
}

export class BatchDeliverOrdersUseCase {
  async execute(data: BatchDeliverOrdersDTO, userId: string) {
    const { orderIds, payments = [], deliveredByName } = data;

    if (!orderIds || orderIds.length === 0) {
      throw new Error('Debe proporcionar al menos un ID de pedido');
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Obtener pedidos con relaciones
      const orders = await tx.order.findMany({
        where: { id: { in: orderIds } },
        include: {
          client: {
            include: {
              clientAccount: true
            }
          },
          payments: true,
          brand: true
        }
      });

      if (orders.length !== orderIds.length) {
        throw new Error('Uno o más pedidos no fueron encontrados');
      }

      // Validar que todos los pedidos sean del mismo cliente
      const clientIds = new Set(orders.map(o => o.clientId));
      if (clientIds.size > 1) {
        throw new Error('Todos los pedidos seleccionados deben pertenecer a la misma empresaria');
      }

      const clientId = orders[0].clientId;
      const clientName = orders[0].clientName;
      const client = orders[0].client;

      // Validar estado de los pedidos
      for (const order of orders) {
        if (order.status !== 'RECIBIDO_EN_BODEGA') {
          throw new Error(`El pedido ${order.receiptNumber} no está en estado RECIBIDO_EN_BODEGA`);
        }
      }

      // 2. Preparar datos para entrega y puntos
      const appliedAmounts: Record<string, number> = {};
      let clientAccount = client.clientAccount;

      if (!clientAccount) {
        clientAccount = await tx.clientAccount.create({
          data: {
            clientId,
            totalRewardPoints: 0,
            totalOrders: 0,
            totalSpent: 0,
            rewardLevel: 'BRONCE'
          }
        });
      }

      let totalPending = 0;
      const orderPendingAmounts = orders.map(order => {
        const effectiveTotal = order.realInvoiceTotal ? Number(order.realInvoiceTotal) : Number(order.total);
        const paidAmount = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const pending = effectiveTotal - paidAmount;
        totalPending += pending;
        return { orderId: order.id, pending, receiptNumber: order.receiptNumber };
      });

      // 3. Procesar pagos si existen
      const totalAggregatePayment = payments.reduce((sum, p) => sum + p.amount, 0);

      if (totalAggregatePayment > 0) {
        if (totalAggregatePayment > totalPending + 0.01) {
          throw new Error(`El monto total de los pagos ($${totalAggregatePayment.toFixed(2)}) no puede ser mayor al saldo total pendiente ($${totalPending.toFixed(2)})`);
        }

        for (const payment of payments) {
          if (payment.amount <= 0) continue;

          const isCredit = payment.paymentMethod === 'CREDITO_CLIENTE';

          // Buscar cuenta bancaria para el registro financiero
          let bankAccountId = payment.bankAccountId;
          if (payment.paymentMethod === 'EFECTIVO' && !bankAccountId) {
            const cashAccount = await tx.bankAccount.findFirst({ where: { type: 'CASH' } });
            bankAccountId = cashAccount?.id;
          }

          // Crear registro financiero
          const referenceNumber = payment.reference || `BATCH-DEL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          
          await tx.financialRecord.create({
            data: {
              type: 'PAYMENT',
              referenceNumber,
              amount: payment.amount,
              date: new Date(),
              clientId,
              clientName,
              bankAccountId: bankAccountId || (await tx.bankAccount.findFirst({ where: { type: 'CASH' } }))?.id || '',
              source: 'ORDER_PAYMENT',
              paymentMethod: payment.paymentMethod,
              movementType: 'INCOME',
              createdBy: userId,
              notes: `Pago lote entrega (${payment.paymentMethod}). Lote de ${orders.length} pedidos. ${isCredit ? '(Crédito)' : ''}`
            }
          });

          // Actualizar saldos bancarios o créditos
          if (isCredit) {
             const availableCredits = await tx.clientCredit.findMany({
              where: { clientAccount: { clientId }, status: 'AVAILABLE' },
              select: {
                id: true,
                remainingAmount: true,
                version: true,
                status: true
              },
              orderBy: { createdAt: 'asc' }
            });

            let creditToSubtract = payment.amount;
            for (const credit of availableCredits) {
              if (creditToSubtract <= 0) break;
              const amountToSubtract = Math.min(Number(credit.remainingAmount), creditToSubtract);

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

              creditToSubtract -= amountToSubtract;
            }

            // Sync ClientAccount with optimistic locking
            const clientAccountData = await tx.clientAccount.findUnique({
              where: { id: clientAccount.id },
              select: { id: true, totalCreditAvailable: true, version: true }
            });

            if (!clientAccountData) {
              throw new Error(`Client account not found: ${clientAccount.id}`);
            }

            const accountResult = await tx.clientAccount.updateMany({
              where: {
                id: clientAccount.id,
                version: clientAccountData.version
              },
              data: {
                totalCreditAvailable: { decrement: payment.amount },
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
          } else if (bankAccountId) {
            // Read account with version
            const bankAccount = await tx.bankAccount.findUnique({
              where: { id: bankAccountId },
              select: { id: true, currentBalance: true, version: true, name: true }
            });

            if (!bankAccount) {
              throw new Error(`Bank account ${bankAccountId} not found`);
            }

            // Validate financial integrity
            validateBankAccountBalance(
              Number(bankAccount.currentBalance),
              payment.amount,
              bankAccountId,
              bankAccount.name
            );

            // Update with optimistic locking
            const result = await tx.bankAccount.updateMany({
              where: {
                id: bankAccountId,
                version: bankAccount.version
              },
              data: {
                currentBalance: { increment: payment.amount },
                updatedAt: new Date(),
                version: { increment: 1 }
              }
            });

            if (result.count === 0) {
              throw new ConcurrencyError(
                'Bank account was modified by another transaction. Please retry.',
                'BankAccount',
                bankAccountId
              );
            }
          }
        }

        // Distribuir el total pagado entre los pedidos
        let remainingToDistribute = totalAggregatePayment;
        const mainPaymentMethod = payments.length > 1 ? 'MIXTO' : (payments[0]?.paymentMethod || 'EFECTIVO');

        for (const op of orderPendingAmounts) {
          if (remainingToDistribute <= 0) break;
          const amountToApply = Math.min(op.pending, remainingToDistribute);
          if (amountToApply > 0) {
            await tx.orderPayment.create({
              data: {
                orderId: op.orderId,
                amount: amountToApply,
                method: mainPaymentMethod,
                description: `Pago lote en entrega (${payments.length} métodos)`
              }
            });
            appliedAmounts[op.orderId] = amountToApply;
            remainingToDistribute -= amountToApply;
          }
        }
      }

      // 4. Actualizar pedidos y puntos
      let totalPointsEarned = 0;
      let totalSpentInBatch = 0;
      const rule = await tx.loyaltyRule.findFirst({ where: { isActive: true, type: 'POR_MONTO' } });

      for (const order of orders) {
        const effectiveTotal = order.realInvoiceTotal ? Number(order.realInvoiceTotal) : Number(order.total);
        totalSpentInBatch += effectiveTotal;

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'ENTREGADO',
            deliveryDate: new Date(),
            deliveredByName: deliveredByName || null,
            updatedAt: new Date(),
            version: { increment: 1 }
          }
        });

        await tx.inventoryMovement.create({
          data: {
            orderId: order.id,
            clientId: order.clientId,
            brandId: order.brandId,
            type: 'DELIVERED',
            createdBy: userId,
            notes: `Entrega en lote (Pedido ${order.receiptNumber})`
          }
        });

        if (rule) {
          const paidBefore = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
          const appliedInBatch = appliedAmounts[order.id] || 0;
          const totalPaidForOrder = paidBefore + appliedInBatch;

          const divisor = parseFloat(rule.condition || '10');
          const safeDivisor = isNaN(divisor) || divisor <= 0 ? 10 : divisor;
          const points = Math.floor(totalPaidForOrder / safeDivisor) * rule.pointsValue;
          totalPointsEarned += points;

          await tx.rewardApplication.create({
            data: {
              clientAccountId: clientAccount.id,
              orderId: order.id,
              pointsEarned: points
            }
          });
        }
      }

      // 5. Finalizar cuenta del cliente con optimistic locking
      const finalClientAccount = await tx.clientAccount.findUnique({
        where: { id: clientAccount.id },
        select: { id: true, version: true }
      });

      if (!finalClientAccount) {
        throw new Error(`Client account not found: ${clientAccount.id}`);
      }

      const updatedPoints = clientAccount.totalRewardPoints + totalPointsEarned;
      const updatedOrders = clientAccount.totalOrders + orders.length;
      const updatedSpent = Number(clientAccount.totalSpent) + totalSpentInBatch;

      let newLevel = 'BRONCE';
      if (updatedPoints >= 600) newLevel = 'PLATINO';
      else if (updatedPoints >= 300) newLevel = 'ORO';
      else if (updatedPoints >= 100) newLevel = 'PLATA';

      const finalResult = await tx.clientAccount.updateMany({
        where: {
          id: clientAccount.id,
          version: finalClientAccount.version
        },
        data: {
          totalRewardPoints: updatedPoints,
          totalOrders: updatedOrders,
          totalSpent: updatedSpent,
          rewardLevel: newLevel,
          version: { increment: 1 }
        }
      });

      if (finalResult.count === 0) {
        throw new ConcurrencyError(
          'Client account was modified by another transaction. Please retry.',
          'ClientAccount',
          clientAccount.id
        );
      }

      return {
        success: true,
        deliveredCount: orders.length,
        totalPointsEarned,
        newLevel
      };
    });
  }
}
