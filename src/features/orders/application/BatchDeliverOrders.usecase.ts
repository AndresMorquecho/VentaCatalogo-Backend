import { prisma } from '../../../lib/prisma';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientCreditBalance } from '../../../shared/utils/financialValidations';
import { buildNotesJSON, cardTitleFromMethod, generateGroupId } from '../../../shared/utils/transactionNotes';

export interface CreditDistributionItemDTO {
  targetOrderId?: string;
  amount: number;
  description: string;
  isCashReturn?: boolean;
  bankAccountId?: string;
}

export interface CreditDistributionDTO {
  sourceOrderId: string;
  totalCreditAmount: number;
  distributions: CreditDistributionItemDTO[];
}

export interface BatchDeliverOrdersDTO {
  orderIds: string[];
  payments?: {
    amount: number;
    bankAccountId?: string;
    paymentMethod: string;
    reference?: string;
  }[];
  deliveredByName?: string;
  creditDistributions?: CreditDistributionDTO[];
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
        const hasSplitPayment = order.payments.some(p => p.method === 'SPLIT_PAYMENT');
        const paidAmount = order.payments
          .filter(p => !(hasSplitPayment && p.method === 'CREDITO_CLIENTE'))
          .reduce((sum, p) => sum + Number(p.amount), 0);
        let pending = effectiveTotal - paidAmount;
        
        if (data.creditDistributions) {
          data.creditDistributions.forEach(distGroup => {
            if (distGroup.distributions) {
              const toThis = distGroup.distributions.find(d => d.targetOrderId === order.id);
              if (toThis) pending -= toThis.amount;
            }
          });
        }
        
        pending = Math.max(0, pending);
        totalPending += pending;
        return { orderId: order.id, pending, receiptNumber: order.receiptNumber };
      });

      // 3. Procesar pagos si existen
      const accountBalancesMap = new Map<string, number>();
      let clientWalletRunningBal: number | null = null;
      const totalAggregatePayment = payments.reduce((sum, p) => sum + p.amount, 0);

      // One groupId for ALL payment legs of this batch delivery (they form a single card)
      const batchPaymentGroupId = generateGroupId();

      // Build shared order context for notes
      const batchOrderContexts = orders.map(o => ({
        receiptNumber: o.receiptNumber,
        orderNumber: o.orderNumber ?? undefined,
        brandName: (o as any).brand?.name ?? undefined,
      }));
      const firstClientDoc = (orders[0] as any).client?.identificationNumber || orders[0].clientId || '—';

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

          let balanceBefore: number | null = null;
          let balanceAfter: number | null = null;

          if (isCredit) {
            if (clientWalletRunningBal === null) {
              const clientAccData = await tx.clientAccount.findUnique({
                where: { clientId },
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

          // Crear registro financiero
          const referenceNumber = payment.reference || `BATCH-DEL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

          const paymentNotesJson = buildNotesJSON({
            title: cardTitleFromMethod(payment.paymentMethod),
            module: 'BATCH_DELIVERY',
            clientDoc: firstClientDoc,
            orders: batchOrderContexts,
          });

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
              movementType: isCredit ? 'INTERNAL' : 'INCOME',
              fromAccountType: isCredit ? 'WALLET' : 'EXTERNAL',
              toAccountType: isCredit ? 'ORDER' : 'CASH',
              createdBy: userId,
              notes: paymentNotesJson,
              balanceBefore,
              balanceAfter,
              version: 1
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

      // 4. Actualizar pedidos
      let totalSpentInBatch = 0;

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

        // Logística de Cambios - Sincronizar estado a ENTREGADO
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
            console.log(`[Sync-Batch-Delivery] Exchange Batch ${batchItem.batchId} updated to ENTREGADO because shadow order ${order.receiptNumber} was delivered in batch`);
          }
        }
      }

      // 6. Process all credit distributions (one for each source order in the batch that has surplus)
      if (data.creditDistributions && data.creditDistributions.length > 0) {
        for (const distSource of data.creditDistributions) {
          const sourceOrderId = distSource.sourceOrderId;
          const sourceOrder = orders.find(o => o.id === sourceOrderId);
          if (!sourceOrder) continue;

          for (const dist of distSource.distributions) {
             if (dist.amount <= 0.005) continue;

             if (dist.isCashReturn) {
              // Cash refund to client → EXPENSE financial record
              const refundAccountId = dist.bankAccountId || (await tx.bankAccount.findFirst({ where: { type: 'CASH' } }))?.id || '';
              const refundAccount = await tx.bankAccount.findUnique({ where: { id: refundAccountId }, select: { currentBalance: true, version: true, name: true, type: true } });

              const isBank = refundAccount?.type !== 'CASH';

              const refundNotesJson = buildNotesJSON({
                title: isBank ? 'REEMBOLSO_BANCARIO' : 'REEMBOLSO_CASH',
                module: 'BATCH_DELIVERY',
                clientDoc: firstClientDoc,
                orders: [{ receiptNumber: sourceOrder.receiptNumber, orderNumber: sourceOrder.orderNumber ?? undefined, brandName: (sourceOrder as any).brand?.name ?? undefined }],
                extra: dist.description,
              });

              await tx.financialRecord.create({
                data: {
                  type: 'EXPENSE',
                  referenceNumber: `REFUND-BATCH-${Date.now()}`,
                  amount: dist.amount,
                  date: new Date(),
                  clientId: clientId,
                  clientName: clientName,
                  orderId: sourceOrderId,
                  bankAccountId: refundAccountId,
                  source: 'CREDIT_DISTRIBUTION',
                  paymentMethod: isBank ? 'TRANSFERENCIA' : 'EFECTIVO',
                  movementType: 'EXPENSE',
                  fromAccountType: isBank ? 'BANK' : 'CASH',
                  toAccountType: 'EXTERNAL',
                  createdBy: userId,
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
              // Apply credit to another order → create a payment for that order
              await tx.orderPayment.create({
                data: {
                  orderId: dist.targetOrderId,
                  amount: dist.amount,
                  method: 'CREDITO_CLIENTE',
                  description: dist.description
                }
              });

              // Distribution group: FROM source order TO target order
              const distGroupId = generateGroupId();
              const distNotesBase = buildNotesJSON({
                title: 'TRASPASO_SALDO',
                module: 'BATCH_DELIVERY',
                clientDoc: firstClientDoc,
                orders: [
                  { receiptNumber: sourceOrder.receiptNumber, orderNumber: sourceOrder.orderNumber ?? undefined, brandName: (sourceOrder as any).brand?.name ?? undefined },
                  { receiptNumber: orders.find(o => o.id === dist.targetOrderId)?.receiptNumber || dist.targetOrderId!, orderNumber: orders.find(o => o.id === dist.targetOrderId)?.orderNumber ?? undefined },
                ],
                extra: dist.description,
              });

              // Create expense leg (source order losing credit)
              await tx.financialRecord.create({
                data: {
                  type: 'EXPENSE',
                  referenceNumber: `DIST-B-FROM-${Date.now()}`,
                  amount: dist.amount,
                  date: new Date(),
                  clientId: clientId,
                  clientName: clientName,
                  orderId: sourceOrderId,
                  bankAccountId: (await tx.bankAccount.findFirst({ where: { type: 'CASH' } }))?.id || '',
                  source: 'CREDIT_DISTRIBUTION',
                  paymentMethod: 'CREDITO_CLIENTE',
                  movementType: 'EXPENSE',
                  fromAccountType: 'ORDER',
                  toAccountType: 'ORDER',
                  createdBy: userId,
                  notes: distNotesBase,
                  transactionGroupId: distGroupId,
                  version: 1
                }
              });

              // Create income leg (target order receiving credit)
              await tx.financialRecord.create({
                data: {
                  type: 'PAYMENT',
                  referenceNumber: `DIST-B-TO-${Date.now()}`,
                  amount: dist.amount,
                  date: new Date(),
                  clientId: clientId,
                  clientName: clientName,
                  orderId: dist.targetOrderId,
                  bankAccountId: (await tx.bankAccount.findFirst({ where: { type: 'CASH' } }))?.id || '',
                  source: 'CREDIT_DISTRIBUTION',
                  paymentMethod: 'CREDITO_CLIENTE',
                  movementType: 'INCOME',
                  fromAccountType: 'ORDER',
                  toAccountType: 'ORDER',
                  createdBy: userId,
                  notes: distNotesBase,
                  transactionGroupId: distGroupId,
                  version: 1
                }
              });
            } else {
              // Move to wallet → create ClientCredit
              const clientAccountData = await tx.clientAccount.findUnique({
                where: { id: clientAccount.id }, // reuse our clientAccount
                select: { id: true, totalCreditAvailable: true, version: true }
              });

              await tx.clientCredit.create({
                data: {
                  clientAccountId: clientAccount.id,
                  amount: dist.amount,
                  remainingAmount: dist.amount,
                  status: 'AVAILABLE',
                  originTransactionId: `BATCH-CREDIT-${sourceOrderId}-${Date.now()}`,
                  originOrderId: sourceOrderId
                }
              });

              await tx.clientAccount.updateMany({
                where: { id: clientAccount.id, version: clientAccountData!.version },
                data: { totalCreditAvailable: { increment: dist.amount }, version: { increment: 1 } }
              });

              const walletNotesJson = buildNotesJSON({
                title: 'RECARGA_BILLETERA',
                module: 'BATCH_DELIVERY',
                clientDoc: firstClientDoc,
                orders: [{ receiptNumber: sourceOrder.receiptNumber, orderNumber: sourceOrder.orderNumber ?? undefined, brandName: (sourceOrder as any).brand?.name ?? undefined }],
                extra: dist.description,
              });

              await tx.financialRecord.create({
                data: {
                  type: 'CREDIT',
                  referenceNumber: `WALLET-B-${Date.now()}`,
                  amount: dist.amount,
                  date: new Date(),
                  clientId: clientId,
                  clientName: clientName,
                  orderId: sourceOrderId,
                  bankAccountId: (await tx.bankAccount.findFirst({ where: { type: 'CASH' } }))?.id || '',
                  source: 'CREDIT_DISTRIBUTION',
                  paymentMethod: 'CREDITO_CLIENTE',
                  movementType: 'INTERNAL',
                  fromAccountType: 'ORDER',
                  toAccountType: 'WALLET',
                  createdBy: userId,
                  notes: walletNotesJson,
                  version: 1
                }
              });            }
          }
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

      const updatedOrders = clientAccount.totalOrders + orders.length;
      const updatedSpent = Number(clientAccount.totalSpent) + totalSpentInBatch;

      const finalResult = await tx.clientAccount.updateMany({
        where: {
          id: clientAccount.id,
          version: finalClientAccount.version
        },
        data: {
          totalOrders: updatedOrders,
          totalSpent: updatedSpent,
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
        totalPointsEarned: 0,
        newLevel: clientAccount.rewardLevel
      };
    });
  }
}
