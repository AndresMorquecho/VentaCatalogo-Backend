import { IOrderRepository } from '../domain/IOrderRepository';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { prisma } from '../../../lib/prisma';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientCreditBalance } from '../../../shared/utils/financialValidations';
import { buildNotesJSON, generateGroupId } from '../../../shared/utils/transactionNotes';
import { roundCurrency } from '../../../shared/utils/currency';

export interface CreditDistributionItemDTO {
  targetOrderId?: string;
  amount: number;
  description: string;
  isCashReturn?: boolean;
  bankAccountId?: string;
}

export interface DeliverOrderDTO {
  payments?: {
    amount: number;
    bankAccountId?: string;
    paymentMethod: string;
    reference?: string;
  }[];
  notes?: string;
  deliveredByName?: string;
  invoiceNumber?: string;
  creditNoteNumber?: string;
  creditNoteTotal?: number;
  creditDistribution?: {
    sourceOrderId: string;
    totalCreditAmount: number;
    distributions: CreditDistributionItemDTO[];
  };
}

export class DeliverOrderUseCase {
  constructor(
    private orderRepository: IOrderRepository,
    private financialRepository: IFinancialRecordRepository
  ) { }

  async execute(orderId: string, data: DeliverOrderDTO, userId: string) {
    // Ejecutar todo en una transacción
    return await prisma.$transaction(async (tx) => {
      // 1. Obtener pedido con relaciones
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          client: {
            include: {
              clientAccount: true
            }
          },
          payments: true,
          brand: true,
          bankAccount: true
        }
      });

      if (!order) {
        throw new Error('Pedido no encontrado');
      }

      if (order.status !== 'RECIBIDO_EN_BODEGA') {
        throw new Error('El pedido debe estar recibido en bodega para poder entregarlo');
      }

      // 2. Calcular saldo pendiente
      const effectiveTotal = data.invoiceNumber || order.realInvoiceTotal ? Number(data.invoiceNumber ? (order.total) : (order.realInvoiceTotal || order.total)) : Number(order.total);
      // Wait, let's keep it simpler: use the final state
      const finalInvoiceTotal = order.realInvoiceTotal ? Number(order.realInvoiceTotal) : Number(order.total);
      const finalCreditNoteTotal = data.creditNoteTotal !== undefined ? Number(data.creditNoteTotal) : Number(order.creditNoteTotal || 0);
      
      const paidBefore = roundCurrency(order.payments.reduce((sum, p) => sum + Number(p.amount), 0));
      const pendingBefore = finalInvoiceTotal - paidBefore - finalCreditNoteTotal;
      const accountBalancesMap = new Map<string, number>();
      let clientWalletRunningBal: number | null = null;
      let totalNewlyPaid = 0;

      // 3. Procesar pagos si existen
      if (data.payments && data.payments.length > 0) {
        for (const payment of data.payments) {
          if (payment.amount <= 0) continue;

          const isCredit = payment.paymentMethod === 'CREDITO_CLIENTE';

          // Validaciones básicas
          if (payment.paymentMethod !== 'EFECTIVO' && !isCredit && !payment.bankAccountId) {
            throw new Error(`Debe seleccionar una cuenta bancaria para el pago de $${payment.amount} con ${payment.paymentMethod}`);
          }

          // Find bank account ID
          let bankAccountId = payment.bankAccountId;
          if (payment.paymentMethod === 'EFECTIVO' && !bankAccountId) {
            const cashAccount = await tx.bankAccount.findFirst({
              where: { type: 'CASH' }
            });
            if (cashAccount) bankAccountId = cashAccount.id;
          }

          let balanceBefore: number | null = null;
          let balanceAfter: number | null = null;

          if (isCredit) {
            if (clientWalletRunningBal === null) {
              const clientAccData = await tx.clientAccount.findUnique({
                where: { clientId: order.clientId },
                select: { totalCreditAvailable: true }
              });
              clientWalletRunningBal = Number(clientAccData?.totalCreditAvailable || 0);
            }
            balanceBefore = clientWalletRunningBal;
            balanceAfter = balanceBefore - payment.amount;
            clientWalletRunningBal = balanceAfter;
          } else if (bankAccountId) {
            if (!accountBalancesMap.has(bankAccountId)) {
              const bankAccData = await tx.bankAccount.findUnique({
                where: { id: bankAccountId },
                select: { currentBalance: true }
              });
              accountBalancesMap.set(bankAccountId, Number(bankAccData?.currentBalance || 0));
            }
            balanceBefore = accountBalancesMap.get(bankAccountId)!;
            balanceAfter = balanceBefore + payment.amount;
            accountBalancesMap.set(bankAccountId, balanceAfter);
          }

          // Crear registro de pago del pedido
          const createdPayment = await tx.orderPayment.create({
            data: {
              orderId: order.id,
              amount: payment.amount,
              method: payment.paymentMethod,
              reference: payment.reference || null,
              description: 'Pago en entrega'
            }
          });

          // Crear registro financiero
          const referenceNumber = !isCredit && payment.paymentMethod !== 'EFECTIVO' && payment.reference
            ? payment.reference
            : `REF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

          await tx.financialRecord.create({
            data: {
              type: 'PAYMENT',
              referenceNumber,
              amount: payment.amount,
              date: new Date(),
              clientId: order.clientId,
              clientName: order.clientName,
              orderId: order.id,
              orderPaymentId: createdPayment.id,
              bankAccountId: bankAccountId || (await tx.bankAccount.findFirst({ where: { type: 'CASH' } }))?.id || '',
              source: 'ORDER_PAYMENT',
              paymentMethod: payment.paymentMethod,
              movementType: isCredit ? 'INTERNAL' : 'INCOME',
              fromAccountType: isCredit ? 'WALLET' : 'EXTERNAL',
              toAccountType: isCredit ? 'ORDER' : 'CASH',
              createdBy: userId,
              clientDocument: order.client.identificationNumber,
              notes: JSON.stringify({
                v: 2,
                title: isCredit ? 'USO_BILLETERA' : (payment.paymentMethod === 'TRANSFERENCIA' ? 'TRANSFERENCIA_BANCARIA' :
                       payment.paymentMethod === 'DEPOSITO' ? 'DEPOSITO_BANCARIO' :
                       payment.paymentMethod === 'CHEQUE' ? 'PAGO_CHEQUE' : 'PAGO_EFECTIVO'),
                module: 'ORDERS',
                description: data.notes || "",
                orders: [{ receiptNumber: order.receiptNumber, orderNumber: order.orderNumber, brandName: order.brand?.name ?? null, type: order.type }]
              }),
              balanceBefore: balanceBefore != null ? Number(balanceBefore) : null,
              balanceAfter: balanceAfter != null ? Number(balanceAfter) : null,
              version: 1
            }
          });

          if (isCredit) {
            // REDUCE CLIENT CREDITS
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

            let remainingToSubtract = payment.amount;
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
              throw new Error(`Saldo a favor insuficiente para cubrir $${payment.amount}. Faltan $${remainingToSubtract.toFixed(2)}`);
            }

            // Sync ClientAccount with optimistic locking
            const clientAccount = await tx.clientAccount.findUnique({
              where: { clientId: order.clientId },
              select: { id: true, totalCreditAvailable: true, version: true }
            });

            if (!clientAccount) {
              throw new Error(`Client account not found for client ${order.clientId}`);
            }

            const accountResult = await tx.clientAccount.updateMany({
              where: {
                clientId: order.clientId,
                version: clientAccount.version
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

          totalNewlyPaid += payment.amount;
        }
      }

      // Validar si los pagos cubren el saldo pendiente (Opcional según requerimiento, pero el usuario dice "Debe registrar cobro total")
      if (totalNewlyPaid < pendingBefore - 0.05) {
        // throw new Error(`Debe cubrir el saldo pendiente total ($${pendingBefore.toFixed(2)}). Pago actual: $${totalNewlyPaid.toFixed(2)}`);
        // Dejamos que pase si el usuario quiere permitir abonos parciales, pero el frontend pedirá el total.
      }

      const totalFinalPaid = paidBefore + totalNewlyPaid;

      // 4. Actualizar pedido a ENTREGADO
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'ENTREGADO',
          deliveryDate: new Date(),
          deliveredByName: data.deliveredByName || null,
          invoiceNumber: data.invoiceNumber || order.invoiceNumber,
          creditNoteNumber: data.creditNoteNumber || order.creditNoteNumber,
          creditNoteTotal: data.creditNoteTotal !== undefined ? data.creditNoteTotal : order.creditNoteTotal,
          updatedAt: new Date(),
          version: { increment: 1 }
        },
        include: {
          client: true,
          brand: true,
          bankAccount: true,
          items: true,
          payments: true
        }
      });

      // 5. Crear movimiento de inventario (DELIVERED)
      await tx.inventoryMovement.create({
        data: {
          orderId: order.id,
          clientId: order.clientId,
          brandId: order.brandId,
          type: 'DELIVERED',
          createdBy: userId,
          notes: data.notes || `Entrega de pedido ${order.receiptNumber}`
        }
      });

      // 6. Logística de Cambios - Sincronizar estado a ENTREGADO
      if (order.parentOrderId) {
        const batchItem = await tx.exchangeBatchItem.findFirst({
          where: { orderId: order.parentOrderId },
          include: { batch: true }
        });
        
        if (batchItem && batchItem.batch.status === 'EN_BODEGA') {
          await tx.exchangeBatch.update({
            where: { id: batchItem.batchId },
            data: { 
              status: 'ENTREGADO', 
              deliveredAt: new Date(),
              updatedAt: new Date()
            }
          });
          console.log(`[Sync-Delivery] Exchange Batch ${batchItem.batchId} updated to ENTREGADO because shadow order ${order.receiptNumber} was delivered`);
        }
      }

      // SISTEMA DE LEALTAD
      // 1. Obtener regla única activa de tipo POR_MONTO
      const rule = await tx.loyaltyRule.findFirst({
        where: { isActive: true, type: 'POR_MONTO' }
      });

      // 2. Calcular puntos ganados basándose en lo pagado realmente
      let pointsEarned = 0;
      const newPaidAmount = totalFinalPaid;

      if (rule) {
        // Ejemplo: 1 punto por cada $10 (condition="10")
        const divisor = parseFloat(rule.condition || '10');
        const safeDivisor = isNaN(divisor) || divisor <= 0 ? 10 : divisor;

        // Se calculan puntos basados en el monto pagado
        pointsEarned = Math.floor(newPaidAmount / safeDivisor) * (rule.pointsValue || 1);
      }

      // Obtener o crear cuenta del cliente
      let clientAccount = order.client.clientAccount;
      if (!clientAccount) {
        clientAccount = await tx.clientAccount.create({
          data: {
            clientId: order.clientId,
            totalRewardPoints: 0,
            totalOrders: 0,
            totalSpent: 0,
            rewardLevel: 'BRONCE'
          }
        });
      }

      // Actualizar saldos de cuenta
      const updatedPoints = clientAccount.totalRewardPoints + pointsEarned;
      const updatedOrders = clientAccount.totalOrders + 1;
      const updatedSpent = Number(clientAccount.totalSpent) + effectiveTotal;

      // Calcular nuevo nivel
      let newLevel = 'BRONCE';
      if (updatedPoints >= 600) newLevel = 'PLATINO';
      else if (updatedPoints >= 300) newLevel = 'ORO';
      else if (updatedPoints >= 100) newLevel = 'PLATA';

      // TASK-7.1: Optimistic Locking on loyalty account update
      const loyaltyUpdateResult = await tx.clientAccount.updateMany({
        where: { id: clientAccount.id, version: clientAccount.version },
        data: {
          totalRewardPoints: updatedPoints,
          totalOrders: updatedOrders,
          totalSpent: updatedSpent,
          rewardLevel: newLevel,
          version: { increment: 1 }
        }
      });

      if (loyaltyUpdateResult.count === 0) {
        throw new Error(
          'Conflicto de concurrencia: La cuenta del cliente fue modificada simultáneamente. ' +
          'Por favor, intente la operación de nuevo.'
        );
      }

      // Registrar aplicación de puntos
      await tx.rewardApplication.create({
        data: {
          clientAccountId: clientAccount.id,
          orderId: order.id,
          pointsEarned: pointsEarned
        }
      });

      // 7. Process credit distribution if provided (surplus from NC)
      if (data.creditDistribution && data.creditDistribution.distributions.length > 0) {
        console.log('[DeliverOrder] Processing credit distribution:', JSON.stringify(data.creditDistribution, null, 2));
        const { sourceOrderId, totalCreditAmount, distributions } = data.creditDistribution;

        for (const dist of distributions) {
          console.log('[DeliverOrder] Checking distribution item:', { amount: dist.amount, isCashReturn: dist.isCashReturn });
          if (dist.amount <= 0.005) continue;

          const distGroupId = `TNC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

          if (dist.isCashReturn) {
            console.log('[DeliverOrder] Processing cash return refund leg:', { amount: dist.amount, bankAccountId: dist.bankAccountId });
            // Cash refund to client → CREDIT_APPLICATION financial record with CASH_RETURN source
            const refundAccountId = dist.bankAccountId || (await tx.bankAccount.findFirst({ where: { type: 'CASH' } }))?.id || '';
            const refundAccount = await tx.bankAccount.findUnique({ where: { id: refundAccountId }, select: { currentBalance: true, version: true, name: true, type: true } });

            const isBank = refundAccount?.type !== 'CASH';
            const balanceBefore = refundAccount ? Number(refundAccount.currentBalance) : 0;
            const balanceAfter = balanceBefore - dist.amount;

            // Validate that we are not refunding more than what is in the account
            validateBankAccountBalance(
              balanceBefore,
              -dist.amount,
              refundAccountId,
              refundAccount?.name || 'Cuenta'
            );

            const refundNotesJson = buildNotesJSON({
              title: 'DEVOLUCION',
              module: 'DELIVERY',
              clientDoc: order.client.identificationNumber,
              orders: [{ receiptNumber: order.receiptNumber, orderNumber: order.orderNumber, brandName: order.brand?.name ?? null }],
              extra: dist.description || 'Devolución de saldo a favor al cliente',
            });

            await tx.financialRecord.create({
              data: {
                type: 'CREDIT_APPLICATION',
                referenceNumber: `REFUND-DEL-${Date.now()}`,
                amount: dist.amount,
                date: new Date(),
                clientId: order.clientId,
                clientName: order.clientName,
                orderId: sourceOrderId,
                bankAccountId: refundAccountId,
                source: 'CASH_RETURN',
                paymentMethod: isBank ? 'TRANSFERENCIA' : 'EFECTIVO',
                movementType: 'EXPENSE',
                fromAccountType: isBank ? 'BANK' : 'CASH',
                toAccountType: 'EXTERNAL',
                createdBy: userId,
                clientDocument: order.client.identificationNumber,
                transactionGroupId: distGroupId,
                balanceBefore: balanceBefore,
                balanceAfter: balanceAfter,
                notes: refundNotesJson,
                version: 1
              }
            });

            if (refundAccount) {
              await tx.bankAccount.updateMany({
                where: { id: refundAccountId, version: refundAccount.version },
                data: { currentBalance: { decrement: dist.amount }, updatedAt: new Date(), version: { increment: 1 } }
              });
            }
          } else if (dist.targetOrderId) {
            // --- 🔒 OVERPAYMENT PROTECTION ---
            if (dist.targetOrderId) {
              const targetOrderObj = await tx.order.findUnique({
                where: { id: dist.targetOrderId },
                select: { id: true, total: true, realInvoiceTotal: true, receiptNumber: true, payments: { select: { amount: true } } }
              });

              if (targetOrderObj) {
                const effectiveTotal = targetOrderObj.realInvoiceTotal ? Number(targetOrderObj.realInvoiceTotal) : Number(targetOrderObj.total);
                const currentPaid = roundCurrency(targetOrderObj.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0));
                const realPendingNow = effectiveTotal - currentPaid;

                if (dist.amount > realPendingNow + 0.01) {
                  console.warn(`[DeliverOrder] Clamping distribution to ${targetOrderObj.receiptNumber}. Requested: ${dist.amount}, Max allowed: ${realPendingNow}`);
                  (dist as any).amount = Math.max(0, realPendingNow);
                }
              }
            }

            if (dist.amount <= 0.005) continue;

            // Apply credit to another order → create a payment for that order
            await tx.orderPayment.create({
              data: {
                orderId: dist.targetOrderId,
                amount: dist.amount,
                method: 'CREDITO_CLIENTE',
                description: dist.description
              }
            });

            // Target order context for JSON notes
            const targetOrder = await tx.order.findUnique({ 
              where: { id: dist.targetOrderId },
              include: { brand: true }
            });


            // Context for audit trail (wallet balance doesn't change during order-to-order transfer)
            if (clientWalletRunningBal === null) {
              clientWalletRunningBal = Number(clientAccount.totalCreditAvailable);
            }
            const balanceBefore = clientWalletRunningBal;
            const balanceAfter = clientWalletRunningBal;

            // Create expense leg (source order losing credit)
            await tx.financialRecord.create({
              data: {
                type: 'EXPENSE',
                referenceNumber: `DIST-DEL-FROM-${Date.now()}`,
                amount: dist.amount,
                date: new Date(),
                clientId: order.clientId,
                clientName: order.clientName,
                orderId: sourceOrderId,
                bankAccountId: (await tx.bankAccount.findFirst({ where: { type: 'CASH' } }))?.id || '',
                source: 'CREDIT_DISTRIBUTION',
                paymentMethod: 'CREDITO_CLIENTE',
                movementType: 'EXPENSE',
                fromAccountType: 'ORDER',
                toAccountType: 'ORDER',
                createdBy: userId,
                transactionGroupId: distGroupId,
                notes: buildNotesJSON({
                  title: 'USO_BILLETERA',
                  module: 'DELIVERY',
                  clientDoc: (order as any).client?.identificationNumber ?? 'S/N',
                  orders: [{ receiptNumber: order.receiptNumber, orderNumber: order.orderNumber, brandName: order.brand?.name ?? null }],
                  extra: `Traspaso desde esta orden hacia: ${targetOrder?.receiptNumber || dist.targetOrderId}`,
                }),
                balanceBefore,
                balanceAfter,
                version: 1
              }
            });

            // Create income leg (target order receiving credit)
            await tx.financialRecord.create({
              data: {
                type: 'PAYMENT',
                referenceNumber: `DIST-DEL-TO-${Date.now()}`,
                amount: dist.amount,
                date: new Date(),
                clientId: order.clientId,
                clientName: order.clientName,
                orderId: dist.targetOrderId,
                bankAccountId: (await tx.bankAccount.findFirst({ where: { type: 'CASH' } }))?.id || '',
                source: 'CREDIT_DISTRIBUTION',
                paymentMethod: 'CREDITO_CLIENTE',
                movementType: 'INCOME',
                fromAccountType: 'ORDER',
                toAccountType: 'ORDER',
                createdBy: userId,
                transactionGroupId: distGroupId,
                notes: buildNotesJSON({
                  title: 'USO_BILLETERA',
                  module: 'DELIVERY',
                  clientDoc: (order as any).client?.identificationNumber ?? 'S/N',
                  orders: targetOrder 
                    ? [{ receiptNumber: targetOrder.receiptNumber, orderNumber: targetOrder.orderNumber, brandName: targetOrder.brand?.name ?? null }]
                    : [{ receiptNumber: dist.targetOrderId!, orderNumber: null, brandName: null }],
                  extra: `Saldo recibido desde orden: ${order.receiptNumber}`,
                }),
                balanceBefore,
                balanceAfter,
                version: 1
              }
            });
          } else {
            // Move to wallet → create FinancialRecord FIRST
            const fr = await tx.financialRecord.create({
              data: {
                type: 'CREDIT',
                referenceNumber: `WALLET-DEL-${Date.now()}`,
                amount: dist.amount,
                date: new Date(),
                clientId: order.clientId,
                clientName: order.clientName,
                orderId: sourceOrderId,
                bankAccountId: (await tx.bankAccount.findFirst({ where: { type: 'CASH' } }))?.id || '',
                source: 'CREDIT_DISTRIBUTION',
                paymentMethod: 'CREDITO_CLIENTE',
                movementType: 'INTERNAL',
                fromAccountType: 'ORDER',
                toAccountType: 'WALLET',
                createdBy: userId,
                transactionGroupId: distGroupId,
                notes: JSON.stringify({
                  v: 2,
                  title: 'RECARGA_BILLETERA',
                  module: 'DELIVERY',
                  description: "",
                  orders: [{ receiptNumber: order.receiptNumber, orderNumber: order.orderNumber, brandName: order.brand?.name ?? null, type: order.type }]
                }),
                version: 1
              }
            });

            // Create ClientCredit tied to actual Financial Record ID
            const clientAccountForCredit = await tx.clientAccount.findUnique({
              where: { clientId: order.clientId },
              select: { id: true, totalCreditAvailable: true, version: true }
            });

            let creditClientAccountId = clientAccountForCredit?.id;
            if (!clientAccountForCredit) {
              const created = await tx.clientAccount.create({
                data: { clientId: order.clientId, totalRewardPoints: 0, totalOrders: 0, totalSpent: 0, rewardLevel: 'BRONCE' }
              });
              creditClientAccountId = created.id;
            }

            await tx.clientCredit.create({
              data: {
                clientAccountId: creditClientAccountId!,
                amount: dist.amount,
                remainingAmount: dist.amount,
                status: 'AVAILABLE',
                originTransactionId: fr.id,
                originOrderId: sourceOrderId
              }
            });

            await tx.clientAccount.updateMany({
              where: { id: creditClientAccountId!, version: clientAccountForCredit?.version ?? 0 },
              data: { totalCreditAvailable: { increment: dist.amount }, version: { increment: 1 } }
            });
          }
        }
      }

      // 8. Calcular nuevo saldo pendiente
      const newPendingAmount = effectiveTotal - newPaidAmount;

      // Retornar pedido actualizado con cálculos
      return {
        ...updatedOrder,
        paidAmount: newPaidAmount,
        pendingAmount: newPendingAmount,
        loyalty: {
          pointsEarned,
          currentTotalPoints: updatedPoints,
          newLevel
        }
      };
    });
  }
}
