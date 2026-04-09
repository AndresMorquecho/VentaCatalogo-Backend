import { prisma } from '../../../lib/prisma';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientCreditBalance } from '../../../shared/utils/financialValidations';
import { buildNotesJSON, cardTitleFromMethod, generateGroupId } from '../../../shared/utils/transactionNotes';
import { getNextSequence } from '../../../shared/utils/SequenceGenerator';

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
  id?: string;
  orderIds: string[];
  deliveryNumber: string;
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

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        return await prisma.$transaction(async (tx) => {
      // 0. Handle Delivery Batch Creation (w/ Concurrency Control)
      let deliveryBatch;
      let finalDeliveryNumber = data.deliveryNumber;

      if (data.id) {
        // @ts-ignore
        deliveryBatch = await tx.deliveryBatch.findUnique({ where: { id: data.id } });
        if (!deliveryBatch) throw new Error('El lote de entrega a editar no existe');
        finalDeliveryNumber = deliveryBatch.deliveryNumber;
      } else {
        // --- 🔒 CONCURRENCY CHECK ---
        const finalDeliveryNumber = await getNextSequence('EN-', 'DELIVERY', tx);
        console.log(`✅ Robust delivery number generated: ${finalDeliveryNumber}`);
        data.deliveryNumber = finalDeliveryNumber;

        // @ts-ignore
        deliveryBatch = await tx.deliveryBatch.create({
          data: {
            deliveryNumber: finalDeliveryNumber,
            deliveredByName: userId,
            deliveryDate: new Date(),
          }
        });
      }

      // Pre-fetch common account info
      const cashAccount = await tx.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } });
      const cashAccountId = cashAccount?.id || '';

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
      let totalSpentInBatch = 0;
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
            bankAccountId = cashAccountId;
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
            description: "", // User notes not currently captured in batch delivery modal
            extra: `Pago en lote | Entrega: ${finalDeliveryNumber}`
          });

          // @ts-ignore
          await tx.financialRecord.create({
            data: {
              type: 'PAYMENT',
              referenceNumber,
              amount: payment.amount,
              date: new Date(),
              client: { connect: { id: clientId } },
              clientName,
              bankAccount: { connect: { id: bankAccountId || (await tx.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } }))?.id || 'cash-account-1' } },
              source: isCredit ? 'WALLET' : 'ORDER_PAYMENT',
              paymentMethod: payment.paymentMethod,
              movementType: isCredit ? 'INTERNAL' : 'INCOME',
              fromAccountType: isCredit ? 'WALLET' : 'EXTERNAL',
              toAccountType: isCredit ? 'ORDER' : 'CASH',
              createdBy: userId,
              notes: paymentNotesJson,
              deliveryBatch: { connect: { id: deliveryBatch.id } },
              version: 1
            } as any
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

            // Intermediate balance tracking happens in clientWalletRunningBal only
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
            // @ts-ignore
            await tx.orderPayment.create({
              data: {
                orderId: op.orderId,
                amount: amountToApply,
                method: mainPaymentMethod,
                description: `Pago lote en entrega (${payments.length} métodos)`,
                // @ts-ignore
                deliveryBatchId: deliveryBatch.id
              }
            });
            appliedAmounts[op.orderId] = amountToApply;
            remainingToDistribute -= amountToApply;
          }
        }
      }

      // 4. Actualizar pedidos

      for (const order of orders) {
        const effectiveTotal = order.realInvoiceTotal ? Number(order.realInvoiceTotal) : Number(order.total);
        totalSpentInBatch += effectiveTotal;

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'ENTREGADO',
            deliveryDate: new Date(),
            deliveredByName: deliveredByName || null,
            // @ts-ignore
            deliveryBatchId: deliveryBatch.id,
            // @ts-ignore
            deliveryNumber: deliveryBatch.deliveryNumber,
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
        console.log('[BatchDeliverOrders] Processing distributions:', data.creditDistributions.length);
        // Pre-fetch TARGET orders for distributions to avoid repetitive sub-queries
        const targetOrderIds = data.creditDistributions.flatMap(ds => ds.distributions.map(d => d.targetOrderId)).filter(Boolean) as string[];
        const targetOrdersFromDB = await tx.order.findMany({
          where: { id: { in: targetOrderIds } },
          include: { brand: true, payments: true }
        });
        const targetOrderMap = new Map(targetOrdersFromDB.map(o => [o.id, o]));

        for (const distSource of data.creditDistributions) {
          const sourceOrderId = distSource.sourceOrderId;
          let sourceOrder = orders.find(o => o.id === sourceOrderId);
          
          if (!sourceOrder) {
             console.log('[BatchDeliverOrders] Source order not in current batch, fetching from DB:', sourceOrderId);
             sourceOrder = await tx.order.findUnique({ where: { id: sourceOrderId }, include: { brand: true, payments: true } }) as any;
          }

          if (!sourceOrder) {
            console.error('[BatchDeliverOrders] Source order NOT FOUND even in DB:', sourceOrderId);
            continue;
          }

          for (const dist of distSource.distributions) {
             if (dist.amount <= 0.005) continue;

             if (dist.isCashReturn) {
              // Cash refund to client → CREDIT_APPLICATION financial record with CASH_RETURN source
              const refundAccountId = dist.bankAccountId || cashAccountId;
              const refundAccount = await tx.bankAccount.findUnique({ where: { id: refundAccountId }, select: { currentBalance: true, version: true, name: true, type: true } });

              const isBank = refundAccount?.type !== 'CASH';
              const refundBalanceBefore = refundAccount ? Number(refundAccount.currentBalance) : 0;
              const refundBalanceAfter = refundBalanceBefore - dist.amount;

              // Validate that we are not refunding more than what is in the account
              validateBankAccountBalance(
                refundBalanceBefore,
                -dist.amount,
                refundAccountId,
                refundAccount?.name || 'Cuenta'
              );

              const refundGroupId = `REFUND-BATCH-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

              const refundNotesJson = buildNotesJSON({
                title: 'DEVOLUCION',
                module: 'BATCH_DELIVERY',
                clientDoc: firstClientDoc,
                orders: [{ receiptNumber: sourceOrder.receiptNumber, orderNumber: sourceOrder.orderNumber ?? undefined, brandName: (sourceOrder as any).brand?.name ?? undefined }],
                description: dist.description || "",
                extra: `Devolución de excedente en entrega | Entrega: ${finalDeliveryNumber}`,
              });

              console.log('[BatchDeliverOrder] Creating refund financial record', { 
                amount: dist.amount, 
                bankAccountId: refundAccountId,
                groupId: refundGroupId
              });

              // @ts-ignore
              await tx.financialRecord.create({
                data: {
                  type: 'CREDIT_APPLICATION',
                  referenceNumber: `REFUND-BATCH-${Date.now()}`,
                  amount: dist.amount,
                  date: new Date(),
                  client: { connect: { id: clientId } },
                  clientName: clientName,
                  order: { connect: { id: sourceOrderId } },
                  bankAccount: { connect: { id: refundAccountId } },
                  source: 'CASH_RETURN',
                  paymentMethod: isBank ? 'TRANSFERENCIA' : 'EFECTIVO',
                  movementType: 'EXPENSE',
                  fromAccountType: isBank ? 'BANK' : 'CASH',
                  toAccountType: 'EXTERNAL',
                  createdBy: userId,
                  clientDocument: firstClientDoc,
                  transactionGroupId: refundGroupId,
                  notes: refundNotesJson,
                  deliveryBatch: { connect: { id: deliveryBatch.id } },
                  version: 1
                } as any
              });

              if (refundAccount) {
                console.log(`[BatchDeliverOrder] Decrementing bank account ${refundAccountId}: -${dist.amount}`);
                await tx.bankAccount.updateMany({
                  where: { id: refundAccountId, version: refundAccount.version },
                  data: { currentBalance: { decrement: dist.amount }, updatedAt: new Date(), version: { increment: 1 } }
                });
              }
            } else if (dist.targetOrderId) {
              // --- 🔒 OVERPAYMENT PROTECTION ---
              // Calculate real current pending balance for the target order
              const targetFromOrders = orders.find(o => o.id === dist.targetOrderId);
              const targetObj = targetFromOrders || targetOrderMap.get(dist.targetOrderId || '');
              
              if (targetObj) {
                const effectiveTotal = targetObj.realInvoiceTotal ? Number(targetObj.realInvoiceTotal) : Number(targetObj.total);
                const currentPaid = targetObj.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
                const alreadyAppliedInThisBatch = appliedAmounts[targetObj.id] || 0;
                const realPendingNow = effectiveTotal - currentPaid - alreadyAppliedInThisBatch;

                if (dist.amount > realPendingNow + 0.01) {
                  console.warn(`[BatchDeliverOrders] Clamping distribution to ${targetObj.receiptNumber}. Requested: ${dist.amount}, Max allowed: ${realPendingNow}`);
                  (dist as any).amount = Math.max(0, realPendingNow);
                }
              }

              if (dist.amount <= 0.005) continue;

              // Apply credit to another order → create a payment for that order
              // @ts-ignore
              const payment = await tx.orderPayment.create({
                data: {
                  orderId: dist.targetOrderId,
                  amount: dist.amount,
                  method: 'CREDITO_CLIENTE',
                  description: dist.description,
                  // @ts-ignore
                  deliveryBatchId: deliveryBatch.id
                }
              });

              // Distribution group: FROM source order TO target order
              const distGroupId = generateGroupId();
              // Robustly resolve target order info for the card
              let targetInfo = orders.find(o => o.id === dist.targetOrderId) || targetOrderMap.get(dist.targetOrderId || '');

              const sourceNotes = buildNotesJSON({
                title: 'USO_BILLETERA',
                module: 'BATCH_DELIVERY',
                clientDoc: firstClientDoc,
                orders: [{ receiptNumber: sourceOrder.receiptNumber, orderNumber: sourceOrder.orderNumber ?? undefined, brandName: (sourceOrder as any).brand?.name ?? undefined }],
                description: dist.description || "",
                extra: `Traspaso desde esta orden hacia: ${targetInfo?.receiptNumber || dist.targetOrderId} | Entrega: ${finalDeliveryNumber}`,
              });

              const targetNotes = buildNotesJSON({
                title: 'USO_BILLETERA',
                module: 'BATCH_DELIVERY',
                clientDoc: firstClientDoc,
                orders: [{ 
                  receiptNumber: targetInfo?.receiptNumber || dist.targetOrderId!, 
                  orderNumber: targetInfo?.orderNumber ?? undefined,
                  brandName: (targetInfo as any)?.brand?.name ?? undefined
                }],
                description: dist.description || "",
                extra: `Saldo recibido desde orden: ${sourceOrder.receiptNumber} | Entrega: ${finalDeliveryNumber}`,
              });

              // Maintenance of client wallet balance for the card 'Saldo' display
              if (clientWalletRunningBal === null) {
                clientWalletRunningBal = Number(clientAccount?.totalCreditAvailable || 0);
              }
              const balanceBefore: number = clientWalletRunningBal;
              const balanceAfter: number = balanceBefore - Number(dist.amount);
              clientWalletRunningBal = balanceAfter;

              // Create expense leg (source order losing credit)
              // @ts-ignore
              await tx.financialRecord.create({
                data: {
                  type: 'EXPENSE',
                  referenceNumber: `DIST-B-FROM-${Date.now()}`,
                  amount: dist.amount,
                  date: new Date(),
                  client: { connect: { id: clientId } },
                  clientName: clientName,
                  order: { connect: { id: sourceOrderId } },
                  bankAccount: { connect: { id: cashAccountId } },
                  source: 'CREDIT_DISTRIBUTION',
                  paymentMethod: 'CREDITO_CLIENTE',
                  movementType: 'EXPENSE',
                  fromAccountType: 'ORDER',
                  toAccountType: 'ORDER',
                  createdBy: userId,
                  notes: sourceNotes,
                  transactionGroupId: distGroupId,
                  deliveryBatch: { connect: { id: deliveryBatch.id } },
                  version: 1
                } as any
              });

              // Create income leg (target order receiving credit)
              // @ts-ignore
              await tx.financialRecord.create({
                data: {
                  type: 'PAYMENT',
                  referenceNumber: `DIST-B-TO-${Date.now()}`,
                  amount: dist.amount,
                  date: new Date(),
                  client: { connect: { id: clientId } },
                  clientName: clientName,
                  order: { connect: { id: dist.targetOrderId! } },
                  orderPayment: { connect: { id: payment.id } },
                  bankAccount: { connect: { id: cashAccountId } },
                  source: 'CREDIT_DISTRIBUTION',
                  paymentMethod: 'CREDITO_CLIENTE',
                  movementType: 'INCOME',
                  fromAccountType: 'ORDER',
                  toAccountType: 'ORDER',
                  createdBy: userId,
                  notes: targetNotes,
                  transactionGroupId: distGroupId,
                  deliveryBatch: { connect: { id: deliveryBatch.id } },
                  version: 1
                } as any
              });
            } else {
              // Move to wallet → create ClientCredit
              const clientAccountData = await tx.clientAccount.findUnique({
                where: { id: clientAccount!.id }, // reuse our clientAccount
                select: { id: true, totalCreditAvailable: true, version: true }
              });

              // Record balance for wallet recharge too
              if (clientWalletRunningBal === null) {
                clientWalletRunningBal = Number(clientAccountData?.totalCreditAvailable || 0);
              }
              const walletBefore: number = clientWalletRunningBal;
              const walletAfter: number = walletBefore + Number(dist.amount);
              clientWalletRunningBal = walletAfter;

              await tx.clientCredit.create({
                data: {
                  clientAccountId: clientAccount!.id,
                  amount: dist.amount,
                  remainingAmount: dist.amount,
                  status: 'AVAILABLE',
                  originTransactionId: `BATCH-CREDIT-${sourceOrderId}-${Date.now()}`,
                  originOrderId: sourceOrderId
                }
              });

              // No intermediate DB update for clientAccount in the loop, we do it once at the end

              const walletNotesJson = buildNotesJSON({
                title: 'RECARGA_BILLETERA',
                module: 'BATCH_DELIVERY',
                clientDoc: firstClientDoc,
                orders: [{ receiptNumber: sourceOrder.receiptNumber, orderNumber: sourceOrder.orderNumber ?? undefined, brandName: (sourceOrder as any).brand?.name ?? undefined }],
                description: dist.description || "",
                extra: `Excedente movido a billetera | Entrega: ${finalDeliveryNumber}`,
              });

              // @ts-ignore
              await tx.financialRecord.create({
                data: {
                  type: 'CREDIT',
                  referenceNumber: `WALLET-B-${Date.now()}`,
                  amount: dist.amount,
                  date: new Date(),
                  client: { connect: { id: clientId } },
                  clientName: clientName,
                  order: { connect: { id: sourceOrderId } },
                  bankAccount: { connect: { id: cashAccountId } },
                  source: 'CREDIT_DISTRIBUTION',
                  paymentMethod: 'CREDITO_CLIENTE',
                  movementType: 'INTERNAL',
                  fromAccountType: 'ORDER',
                  toAccountType: 'WALLET',
                  createdBy: userId,
                  notes: walletNotesJson,
                  deliveryBatch: { connect: { id: deliveryBatch.id } },
                  version: 1
                } as any
              });
          }
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
          totalCreditAvailable: clientWalletRunningBal !== null ? clientWalletRunningBal : clientAccount.totalCreditAvailable,
          version: { increment: 1 }
        }
      });

      if (finalResult.count === 0) {
        console.error(`[BatchDeliverOrders] clientAccount updateMany failed for id: ${clientAccount.id}, version: ${finalClientAccount.version}`);
        throw new ConcurrencyError(
          'Client account was modified by another transaction. Please retry.',
          'ClientAccount',
          clientAccount.id
        );
      }

      return {
        success: true,
        // @ts-ignore
        batchId: deliveryBatch.id,
        deliveryNumber: deliveryBatch.deliveryNumber,
        deliveredCount: orders.length,
        totalPointsEarned: 0,
        newLevel: clientAccount.rewardLevel
      };
        }, { timeout: 40000 });
      } catch (error: any) {
        if (attempts < maxAttempts - 1 && error.code === 'P2002' && error.meta?.target?.includes('delivery_number')) {
          console.log(`⚠️ Concurrency collision detected on deliveryNumber. Retrying... (${attempts + 1}/${maxAttempts})`);
          attempts++;
          // Wait briefly
          await new Promise(resolve => setTimeout(resolve, 100 * attempts));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Could not generate a unique delivery number after multiple attempts.');
  }
}
