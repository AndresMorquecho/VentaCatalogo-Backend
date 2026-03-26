import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';
import { chunkArray } from '../../../shared/utils/arrayHelpers';

export interface BatchReceptionItemDTO {
  orderId: string;
  finalTotal: number;
  invoiceNumber?: string;
  abonoRecepcion?: number;
  bankAccountId?: string;
  paymentMethod?: string;
  reference?: string;
  documentType?: string;
  entryDate?: string;
  creditDistribution?: CreditDistribution;
  fromExchangeBatch?: boolean; // Allow ENTREGADO orders from exchange batches
}

export interface CreditDistribution {
  sourceOrderId: string;
  totalCreditAmount: number;
  distributions: {
    targetOrderId?: string; // null = billetera virtual o devolucion
    amount: number;
    description: string;
    isCashReturn?: boolean; // true = devolucion (no crea credito en billetera)
    bankAccountId?: string; // NEW: The specific account to return money from
  }[];
}

export interface BatchReceptionDTO {
  id?: string;
  packingNumber: string;
  packingTotal: number;
  items: BatchReceptionItemDTO[];
}

interface ProcessedOrder {
  id: string;
  receiptNumber: string;
  orderNumber: string;
  status: string;
  clientId: string;
  clientName: string;
  brandName: string;
  realInvoiceTotal: number;
  invoiceNumber: string | null;
  documentType: string | null;
  payments: any[]; // NUEVO: Incluir pagos para que el frontend calcule saldos
}

/**
 * OPTIMIZED VERSION - Batch Reception UseCase
 * 
 * Performance improvements:
 * - Eliminates loop with await (700+ queries → ~50 queries)
 * - Accumulates financial operations (50 locks → 1-5 locks)
 * - Uses bulk inserts (createMany)
 * - Minimal selects (no heavy includes)
 * - Minimal response payload
 * 
 * Expected performance for 50 orders:
 * - Queries: ~50-60 (vs 700-1000 before)
 * - Time: 2-4 seconds (vs 15-30 seconds before)
 */
export class CreateReceptionBatchOptimizedUseCase {
  private readonly CHUNK_SIZE = 30; // Process in chunks to avoid huge transactions

  async execute(dto: BatchReceptionDTO, userId: string): Promise<Result<any>> {
    console.time('⏱️ BATCH_RECEPTION_TOTAL');
    
    try {
      if (!dto.items || dto.items.length === 0) {
        return Result.fail('No hay pedidos para procesar');
      }

      // For large batches, process in chunks
      if (dto.items.length > this.CHUNK_SIZE) {
        return await this.executeInChunks(dto, userId);
      }

      // For smaller batches, process in single transaction
      const result = await this.processBatch(dto, userId);
      
      console.timeEnd('⏱️ BATCH_RECEPTION_TOTAL');
      return Result.ok(result);
      
    } catch (error) {
      console.timeEnd('⏱️ BATCH_RECEPTION_TOTAL');
      console.error('CreateReceptionBatchOptimizedUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Error al procesar recepción por lote');
    }
  }

  private async executeInChunks(dto: BatchReceptionDTO, userId: string): Promise<any> {
    console.log(`📦 Processing ${dto.items.length} orders in chunks of ${this.CHUNK_SIZE}`);
    
    const chunks = chunkArray(dto.items, this.CHUNK_SIZE);
    const allProcessedOrders: ProcessedOrder[] = [];
    let batch: any;

    for (let i = 0; i < chunks.length; i++) {
      console.time(`⏱️ CHUNK_${i + 1}`);
      
      const chunkDto: BatchReceptionDTO = {
        ...dto,
        items: chunks[i],
        // Only create batch on first chunk, reuse for subsequent chunks
        id: i === 0 ? dto.id : batch?.id
      };

      const result = await this.processBatch(chunkDto, userId);
      
      if (i === 0) {
        batch = result.batch;
      }
      
      allProcessedOrders.push(...result.orders);
      console.timeEnd(`⏱️ CHUNK_${i + 1}`);
    }

    return {
      success: true,
      batchId: batch.id,
      processedCount: allProcessedOrders.length,
      orders: allProcessedOrders
    };
  }

  private async processBatch(dto: BatchReceptionDTO, userId: string): Promise<any> {
    return await prisma.$transaction(async (tx) => {
      console.time('⏱️ TRANSACTION');
      
      let batch;
      
      // ============================================================================
      // STEP 1: Handle batch creation/update
      // ============================================================================
      console.time('⏱️ STEP_1_BATCH');
      
      if (dto.id) {
        batch = await this.handleBatchEdit(tx, dto, userId);
      } else {
        batch = await tx.receptionBatch.create({
          data: {
            packingNumber: dto.packingNumber,
            packingTotal: dto.packingTotal,
            receivedByName: userId,
            receptionDate: new Date(),
          }
        });
      }
      
      console.timeEnd('⏱️ STEP_1_BATCH');

      // ============================================================================
      // STEP 2: Pre-fetch all orders and default accounts in ONE query
      // ============================================================================
      const orderIds = dto.items.map(i => i.orderId);
      
      // We need clientIds to fetch accounts in the main batch
      const tempOrders = await tx.order.findMany({
        where: { id: { in: orderIds } },
        select: { clientId: true }
      });
      const clientIds = Array.from(new Set(tempOrders.map(o => o.clientId)));

      const [orders, defaultCashAccount, allActiveAccounts, clientAccounts] = await Promise.all([
        tx.order.findMany({
          where: { id: { in: orderIds } },
          select: {
            id: true,
            receiptNumber: true,
            orderNumber: true,
            clientId: true,
            clientName: true,
            bankAccountId: true,
            client: { select: { identificationNumber: true } },
            brand: { select: { id: true, name: true } },
            brandId: true,
            total: true,
            realInvoiceTotal: true,
            status: true,
            invoiceNumber: true,
            documentType: true,
            type: true,
            exchangeItemId: true,
            parentOrderId: true,
            payments: {
              select: {
                id: true, amount: true, method: true, reference: true, receiptNumber: true, description: true, createdAt: true
              }
            }
          }
        }),
        tx.bankAccount.findFirst({
          where: { type: 'CASH', isActive: true },
          orderBy: { createdAt: 'asc' }
        }),
        tx.bankAccount.findMany({
          select: { id: true, name: true, currentBalance: true }
        }),
        tx.clientAccount.findMany({
          where: { clientId: { in: clientIds } },
          select: { clientId: true, totalCreditAvailable: true }
        })
      ]);

      if (!defaultCashAccount) {
        throw new Error('No se encontró una cuenta de efectivo activa para procesar la transacción.');
      }

      // Convert to Map/Set for O(1) access
      const ordersMap = new Map(orders.map(o => [o.id, o]));
      const mainCashAccountId = defaultCashAccount.id;
      
      // Track running balances in memory to save balanceBefore/After snapshots
      const accountBalancesMap = new Map(allActiveAccounts.map(a => [a.id, Number(a.currentBalance)]));
      const validBankAccountIds = new Set(allActiveAccounts.map(a => a.id));
      
      // Track client account balances to show credit evolution in cards
      const clientAccountBalancesMap = new Map<string, number>(
        clientAccounts.map(a => [a.clientId, Number(a.totalCreditAvailable)])
      );
      
      console.timeEnd('⏱️ STEP_2_PREFETCH');

      // ============================================================================
      // STEP 3: Validate all orders
      // ============================================================================
      console.time('⏱️ STEP_3_VALIDATE');
      
      for (const item of dto.items) {
        const order = ordersMap.get(item.orderId);
        if (!order) {
          throw new Error(`Pedido ${item.orderId} no encontrado`);
        }
        
        // In edit mode, allow orders that are already received if they belong to this batch
        if (dto.id) {
          // Edit mode: Allow POR_RECIBIR or RECIBIDO_EN_BODEGA (will be re-added to batch)
          if (order.status !== 'POR_RECIBIR' && order.status !== 'RECIBIDO_EN_BODEGA') {
            throw new Error(`El pedido ${order.receiptNumber} ya fue entregado y no puede ser editado`);
          }
        } else {
          // Create mode: Allow POR_RECIBIR, or ENTREGADO if coming from exchange batch
          const itemDto = dto.items.find(i => i.orderId === order.id);
          const isFromExchange = itemDto?.fromExchangeBatch === true;
          if (order.status !== 'POR_RECIBIR' && !(isFromExchange && order.status === 'ENTREGADO')) {
            throw new Error(`El pedido ${order.receiptNumber} ya fue recibido anteriormente`);
          }
        }
      }
      
      console.timeEnd('⏱️ STEP_3_VALIDATE');

      // ============================================================================
      // STEP 4: Prepare all data in memory (NO queries yet)
      // ============================================================================
      console.time('⏱️ STEP_4_PREPARE');
      
      const orderUpdates: any[] = [];
      const inventoryMovements: any[] = [];
      const orderPayments: any[] = [];
      const financialRecords: any[] = [];
      const clientCredits: any[] = [];
      
      // Accumulators for financial operations
      const bankAccountTotals = new Map<string, number>();
      const clientAccountCredits = new Map<string, number>();
      
      // 2. Get last receipt numbers for concurrent generation
      const [lastAbono, lastSaldo] = await Promise.all([
        tx.orderPayment.findFirst({
          where: { receiptNumber: { startsWith: 'REC-ABO-' } },
          orderBy: { receiptNumber: 'desc' },
          select: { receiptNumber: true }
        }),
        tx.orderPayment.findFirst({
          where: { receiptNumber: { startsWith: 'REC-SALDO-' } },
          orderBy: { receiptNumber: 'desc' },
          select: { receiptNumber: true }
        })
      ]);
      
      let nextAbonoNumber = 1;
      if (lastAbono?.receiptNumber) {
        const match = lastAbono.receiptNumber.match(/(\d+)$/);
        if (match) nextAbonoNumber = parseInt(match[1]) + 1;
      }

      let nextSaldoNumber = 1;
      if (lastSaldo?.receiptNumber) {
        const match = lastSaldo.receiptNumber.match(/(\d+)$/);
        if (match) nextSaldoNumber = parseInt(match[1]) + 1;
      }

      // Get last order number for consecutive generation (format: ORD-YYYYMMDD-XXX)
      const today = new Date();
      const datePrefix = `ORD-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      const lastOrder = await tx.order.findFirst({
        where: { orderNumber: { startsWith: datePrefix } },
        orderBy: { createdAt: 'desc' },
        select: { orderNumber: true }
      });
      
      let nextOrderNumber = 1;
      if (lastOrder?.orderNumber) {
        const match = lastOrder.orderNumber.match(/(\d+)$/);
        if (match) nextOrderNumber = parseInt(match[1]) + 1;
      }

      // Process each item in memory
      for (const item of dto.items) {
        const order = ordersMap.get(item.orderId)!;
        
        // Generate orderNumber if it doesn't exist
        const orderNumber = order.orderNumber || `${datePrefix}-${String(nextOrderNumber++).padStart(3, '0')}`;
        const clientDoc = (order as any).client?.identificationNumber || order.clientId || '—';
        
        // Prepare order update
        orderUpdates.push({
          id: order.id,
          status: 'RECIBIDO_EN_BODEGA',
          realInvoiceTotal: item.finalTotal,
          invoiceNumber: item.invoiceNumber || null,
          documentType: item.documentType || 'FACTURA',
          packingNumber: dto.packingNumber,
          packingTotal: dto.packingTotal,
          receptionBatchId: batch.id,
          receptionDate: item.entryDate ? new Date(item.entryDate) : new Date(),
          receivedByName: userId,
          orderNumber: orderNumber,
          updatedAt: new Date(),
          version: { increment: 1 }
        });

        // Prepare inventory movement
        inventoryMovements.push({
          id: crypto.randomUUID(),
          orderId: order.id,
          clientId: order.clientId,
          brandId: order.brandId,
          type: 'ENTRY',
          createdBy: userId,
          notes: `Recepción de pedido ${order.receiptNumber} - Factura: ${item.invoiceNumber || 'N/A'}`,
          createdAt: new Date()
        });

        // Handle payment (abono)
        if (item.abonoRecepcion && item.abonoRecepcion > 0 && item.bankAccountId) {
          const paymentId = crypto.randomUUID();
          const receiptNumber = `REC-ABO-${(nextAbonoNumber++).toString().padStart(6, '0')}`;
          
          orderPayments.push({
            id: paymentId,
            orderId: order.id,
            amount: item.abonoRecepcion,
            method: item.paymentMethod || 'EFECTIVO',
            reference: item.reference || null,
            receiptNumber,
            description: 'Abono en recepción de bodega (Packing)',
            createdAt: new Date()
          });

          const referenceNumber = item.paymentMethod !== 'EFECTIVO' && item.reference
            ? `${item.reference}-${Math.floor(Math.random() * 1000)}`
            : `REF-REC-${Date.now()}-${Math.random().toString(36).substring(7)}`;

          const currentBalance = accountBalancesMap.get(item.bankAccountId) || 0;
          const balanceBefore = currentBalance;
          const balanceAfter = balanceBefore + item.abonoRecepcion;
          accountBalancesMap.set(item.bankAccountId, balanceAfter);

          financialRecords.push({
            id: crypto.randomUUID(),
            type: 'PAYMENT',
            referenceNumber,
            amount: item.abonoRecepcion,
            date: new Date(),
            clientId: order.clientId,
            clientName: order.clientName,
            orderId: order.id,
            orderPaymentId: paymentId,
            bankAccountId: item.bankAccountId,
            source: 'ORDER_PAYMENT',
            paymentMethod: item.paymentMethod || 'EFECTIVO',
            movementType: 'INCOME',
            createdBy: userId,
            notes: `Abono en recepción | Cédula: ${clientDoc} | Orden: ${order.receiptNumber} | Pedido: ${order.orderNumber || '—'} | Marca: ${order.brand?.name || '—'} | Tipo: ${order.type?.toUpperCase() || 'NORMAL'}`,
            clientDocument: clientDoc,
            balanceBefore,
            balanceAfter,
            version: 1,
            createdAt: new Date()
          });

          // Accumulate bank account total
          const currentTotal = bankAccountTotals.get(item.bankAccountId) || 0;
          bankAccountTotals.set(item.bankAccountId, currentTotal + item.abonoRecepcion);
        }

        // Handle credit (saldo a favor)
        const paidAmount = (order.payments || [])
          .reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        const newPaidAmount = paidAmount + (item.abonoRecepcion || 0);
        const pendingAmount = item.finalTotal - newPaidAmount;

        // ====== DEBUG LOGGING ======
        console.log(`\n📦 Processing order ${order.receiptNumber} (${order.id})`);
        console.log(`   total=${order.total}, finalTotal=${item.finalTotal}, existingPaid=${paidAmount}, abonoRecepcion=${item.abonoRecepcion || 0}`);
        console.log(`   newPaidAmount=${newPaidAmount}, pendingAmount=${pendingAmount}`);
        console.log(`   creditDistribution received:`, JSON.stringify(item.creditDistribution, null, 2));
        // ====== END DEBUG ======

        if (pendingAmount < -0.01) {
          const creditAmount = Math.abs(pendingAmount);
          
          console.log(`   ✅ Credit generated: $${creditAmount}`);

          // 1. ENTRADA: Registrar generación del saldo a favor
          const generationBankAccId = order.bankAccountId && validBankAccountIds.has(order.bankAccountId) 
            ? order.bankAccountId 
            : mainCashAccountId;

          const clientAccount = clientAccounts.find(a => a.clientId === order.clientId);
          const walletBalBeforeGen = clientAccountBalancesMap.get(order.clientId) || 0;
          const walletBalAfterGen = walletBalBeforeGen + creditAmount;
          clientAccountBalancesMap.set(order.clientId, walletBalAfterGen);

          financialRecords.push({
            id: crypto.randomUUID(),
            type: 'CREDIT_GENERATION',
            referenceNumber: `CREDIT-GEN-${order.id}-${crypto.randomUUID().slice(0, 8)}`,
            amount: creditAmount,
            date: new Date(),
            clientId: order.clientId,
            clientName: order.clientName,
            orderId: order.id,
            bankAccountId: generationBankAccId,
            source: 'RECEPTION_OVERPAYMENT',
            paymentMethod: 'SALDO_A_FAVOR',
            movementType: 'INCOME',
            createdBy: userId,
            notes: `Saldo a favor generado | Cédula: ${clientDoc} | Orden: ${order.receiptNumber} | Pedido: ${order.orderNumber || '—'} | Marca: ${order.brand?.name || '—'} | Tipo: ${order.type?.toUpperCase() || 'NORMAL'}`,
            clientDocument: clientDoc,
            balanceBefore: walletBalBeforeGen,
            balanceAfter: walletBalAfterGen,
            version: 1,
            createdAt: new Date()
          });

          // 2. Procesar distribuciones si existen
          if (item.creditDistribution && item.creditDistribution.distributions && item.creditDistribution.distributions.length > 0) {
            console.log(`   📋 Processing ${item.creditDistribution.distributions.length} distributions for ${order.receiptNumber}:`);
            
            let distIdx = 0;
            for (const dist of item.creditDistribution.distributions) {
              distIdx++;
              console.log(`      - [${distIdx}] dist: targetOrderId=${dist.targetOrderId}, amount=${dist.amount}, isCashReturn=${dist.isCashReturn}`);
              
              // SALIDA: Registrar aplicación del saldo
              const appBankAccId = order.bankAccountId && validBankAccountIds.has(order.bankAccountId) 
                ? order.bankAccountId 
                : mainCashAccountId;

              const currentAppBalance = accountBalancesMap.get(appBankAccId) || 0;
              
              const distGroupId = crypto.randomUUID();

              const currentWalletBalDist = clientAccountBalancesMap.get(order.clientId) || 0;
              const walletBalBeforeDist = currentWalletBalDist;
              
              // Only subtract from the client's wallet pool if the money is actually leaving the wallet 
              // (e.g. to pay another order or being returned as cash).
              // Distributions to "WALLET" should NOT subtract because they were already added to the pool by CREDIT_GENERATION.
              let walletBalAfterDist = walletBalBeforeDist;
              if (dist.targetOrderId || dist.isCashReturn || (dist as any).is_cash_return) {
                walletBalAfterDist = walletBalBeforeDist - Number(dist.amount);
                clientAccountBalancesMap.set(order.clientId, walletBalAfterDist);
              }

              // [DISTRIBUTION] Branch based on target: Order, Cash Return, or Wallet
              if (dist.targetOrderId) {
                // CASE 1: Distribution to another order (Payment)
                const paymentId = crypto.randomUUID();
                const receiptNumber = `REC-SALDO-${(nextSaldoNumber++).toString().padStart(6, '0')}`;
                
                orderPayments.push({
                   id: paymentId, orderId: dist.targetOrderId, amount: Number(dist.amount),
                   method: 'CREDITO_CLIENTE', reference: `SALDO-DIST-${order.id}`,
                   receiptNumber, description: `Saldo a favor aplicado desde pedido ${order.receiptNumber}`,
                   createdAt: new Date()
                });

                // OUTFLOW LEG: From origin order
                financialRecords.push({
                   id: crypto.randomUUID(), type: 'CREDIT_APPLICATION',
                   referenceNumber: `CREDIT-APP-ORDER-${dist.targetOrderId}-${order.id}-${distIdx}-${crypto.randomUUID().slice(0, 8)}`,
                   amount: Number(dist.amount), date: new Date(), clientId: order.clientId, clientName: order.clientName,
                   orderId: order.id, bankAccountId: appBankAccId, source: 'CREDIT_DISTRIBUTION',
                   paymentMethod: 'SALDO_A_FAVOR', movementType: 'EXPENSE', fromAccountType: 'ORDER', toAccountType: 'ORDER',
                   transactionGroupId: distGroupId, createdBy: userId,
                   notes: `${dist.description} | Cédula: ${(order as any).client?.identificationNumber || '—'} | Orden: ${order.receiptNumber} | Pedido: ${order.orderNumber || '—'} | Marca: ${order.brand?.name || '—'} | Tipo: DISTRIBUCION`,
                   clientDocument: (order as any).client?.identificationNumber,
                   balanceBefore: walletBalBeforeDist, balanceAfter: walletBalAfterDist, version: 1, createdAt: new Date()
                });

                // INFLOW LEG: To destination order
                financialRecords.push({
                   id: crypto.randomUUID(), type: 'ORDER_PAYMENT',
                   referenceNumber: `${receiptNumber}-${crypto.randomUUID().slice(0, 8)}`,
                   amount: Number(dist.amount), date: new Date(), clientId: order.clientId, clientName: order.clientName,
                   orderId: dist.targetOrderId, bankAccountId: order.bankAccountId || mainCashAccountId,
                   source: 'CREDIT_DISTRIBUTION', paymentMethod: 'SALDO_A_FAVOR', movementType: 'INCOME',
                   fromAccountType: 'ORDER', toAccountType: 'ORDER', transactionGroupId: distGroupId, createdBy: userId,
                   notes: `Pago con saldo a favor | Cédula: ${(order as any).client?.identificationNumber || '—'} | Orden: ${order.receiptNumber} | Pedido: ${order.orderNumber || '—'} | Marca: ${order.brand?.name || '—'} | Tipo: ABONO_SALDO_FAVOR`,
                   clientDocument: (order as any).client?.identificationNumber,
                   balanceBefore: walletBalAfterDist, balanceAfter: walletBalAfterDist, version: 1, createdAt: new Date()
                });
              } else if (dist.isCashReturn || (dist as any).is_cash_return) {
                // CASE 2: Cash Return (Reduces bank/cash immediately)
                const returnAccIdRaw = (dist as any).bankAccountId || (dist as any).bank_account_id;
                const returnAccId = (returnAccIdRaw && typeof returnAccIdRaw === 'string' && returnAccIdRaw.length > 5) 
                  ? returnAccIdRaw 
                  : mainCashAccountId;

                const returnAcc = allActiveAccounts.find(a => a.id === returnAccId);
                const isBank = returnAcc && (returnAcc as any).type !== 'CASH';

                const currentCashReturnBalance = accountBalancesMap.get(returnAccId) || 0;
                const balanceBeforeReturn = currentCashReturnBalance;
                const balanceAfterReturn = balanceBeforeReturn - Number(dist.amount);
                accountBalancesMap.set(returnAccId, balanceAfterReturn);

                financialRecords.push({
                   id: crypto.randomUUID(), 
                   type: 'CREDIT_APPLICATION',
                   referenceNumber: `CASH-RETURN-${order.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                   amount: Number(dist.amount), 
                   date: new Date(), 
                   clientId: order.clientId, 
                   clientName: order.clientName,
                   clientDocument: (order as any).client?.identificationNumber,
                   orderId: order.id, 
                   bankAccountId: returnAccId, 
                   source: 'CASH_RETURN', 
                   paymentMethod: isBank ? 'TRANSFERENCIA' : 'EFECTIVO',
                   movementType: 'EXPENSE', 
                   createdBy: userId,
                   notes: `${dist.description} | Cédula: ${(order as any).client?.identificationNumber || '—'} | Orden: ${order.receiptNumber} | Pedido: ${order.orderNumber || '—'} | Marca: ${order.brand?.name || '—'} | Tipo: DEVOLUCION`,
                   balanceBefore: balanceBeforeReturn, 
                   balanceAfter: balanceAfterReturn, 
                   version: 1, 
                   createdAt: new Date()
                });

                const currentTotalCount = bankAccountTotals.get(returnAccId) || 0;
                bankAccountTotals.set(returnAccId, currentTotalCount - Number(dist.amount));
              } else {
                // CASE 3: Save to Virtual Wallet (Stays in digital pool)
                // Outflow record (required by TransactionsTable to show the grouped distribution card)
                financialRecords.push({
                   id: crypto.randomUUID(), type: 'CREDIT_APPLICATION',
                   referenceNumber: `CREDIT-APP-WALLET-${order.id}-${distIdx}-${crypto.randomUUID().slice(0, 8)}`,
                   amount: Number(dist.amount), date: new Date(), clientId: order.clientId, clientName: order.clientName,
                   orderId: order.id, bankAccountId: appBankAccId, source: 'CREDIT_DISTRIBUTION',
                   paymentMethod: 'SALDO_A_FAVOR', movementType: 'EXPENSE', fromAccountType: 'ORDER', toAccountType: 'WALLET',
                   transactionGroupId: distGroupId, createdBy: userId,
                   notes: `Ahorro en billetera | Cédula: ${(order as any).client?.identificationNumber || '—'} | Orden: ${order.receiptNumber} | Pedido: ${order.orderNumber || '—'} | Marca: ${order.brand?.name || '—'} | Tipo: RECARGA_BILLETERA`,
                   clientDocument: (order as any).client?.identificationNumber,
                   balanceBefore: walletBalBeforeDist, balanceAfter: walletBalAfterDist, version: 1, createdAt: new Date()
                });

                // Inflow record to wallet
                financialRecords.push({
                   id: crypto.randomUUID(), type: 'PAYMENT',
                   referenceNumber: `WALLET-REF-${order.id}-${distIdx}-${crypto.randomUUID().slice(0, 8)}`,
                   amount: Number(dist.amount), date: new Date(), clientId: order.clientId, clientName: order.clientName,
                   orderId: order.id, bankAccountId: appBankAccId, source: 'CREDIT_DISTRIBUTION', paymentMethod: 'SALDO_A_FAVOR',
                   movementType: 'INCOME', fromAccountType: 'ORDER', toAccountType: 'WALLET', transactionGroupId: distGroupId, createdBy: userId,
                   notes: `Saldo guardado en billetera virtual | Cédula: ${(order as any).client?.identificationNumber || '—'} | Orden: ${order.receiptNumber} | Pedido: ${order.orderNumber || '—'} | Marca: ${order.brand?.name || '—'} | Tipo: RECARGA`,
                   clientDocument: (order as any).client?.identificationNumber,
                   balanceBefore: walletBalAfterDist, balanceAfter: walletBalAfterDist, version: 1, createdAt: new Date()
                });

                clientCredits.push({
                   id: crypto.randomUUID(), clientAccountId: '', amount: Number(dist.amount), remainingAmount: Number(dist.amount),
                   originTransactionId: `RECEPTION-DIST-${order.id}-${distIdx}-${Date.now()}`,
                   originOrderId: order.id, status: 'AVAILABLE', createdAt: new Date()
                });
                const currentCreditAcc = clientAccountCredits.get(order.clientId) || 0;
                clientAccountCredits.set(order.clientId, currentCreditAcc + Number(dist.amount));
              }

            }

          } else {
            // Register financial records (outflow from order, inflow to wallet)
            const walletBalBefore = clientAccountBalancesMap.get(order.clientId) || 0;
            const walletBalAfter = walletBalBefore; // Moving from Order balance to Wallet balance doesn't change the TOTAL wallet pool for this client yet because it was just generated

            const distGroupId = crypto.randomUUID();

            clientCredits.push({
              id: crypto.randomUUID(),
              clientAccountId: '',
              amount: creditAmount,
              remainingAmount: creditAmount,
              originTransactionId: `RECEPTION-${order.id}-${Date.now()}`,
              originOrderId: order.id,
              status: 'AVAILABLE',
              createdAt: new Date()
            });

            // SALIDA del pedido
            financialRecords.push({
              id: crypto.randomUUID(),
              type: 'CREDIT_APPLICATION',
              referenceNumber: `CREDIT-OUT-${order.id}-${Date.now()}`,
              amount: creditAmount,
              date: new Date(),
              clientId: order.clientId,
              clientName: order.clientName,
              orderId: order.id,
              bankAccountId: order.bankAccountId || mainCashAccountId,
              source: 'CREDIT_DISTRIBUTION',
              paymentMethod: 'SALDO_A_FAVOR',
              movementType: 'EXPENSE', // Sale del pedido
              fromAccountType: 'ORDER',
              toAccountType: 'WALLET',
              transactionGroupId: distGroupId,
              createdBy: userId,
              notes: `Distribución de saldo restante | Cédula: ${(order as any).client?.identificationNumber || '—'} | Orden: ${order.receiptNumber} | Pedido: ${order.orderNumber || '—'} | Marca: ${order.brand?.name || '—'} | Tipo: DISTRIBUCION`,
              clientDocument: (order as any).client?.identificationNumber,
              balanceBefore: walletBalBefore,
              balanceAfter: walletBalAfter,
              version: 1,
              createdAt: new Date()
            });

            // ENTRADA a la billetera
            financialRecords.push({
              id: crypto.randomUUID(),
              type: 'PAYMENT',
              referenceNumber: `CREDIT-IN-${order.id}-${Date.now()}`,
              amount: creditAmount,
              date: new Date(),
              clientId: order.clientId,
              clientName: order.clientName,
              orderId: order.id,
              bankAccountId: order.bankAccountId || mainCashAccountId,
              source: 'CREDIT_DISTRIBUTION',
              paymentMethod: 'SALDO_A_FAVOR',
              movementType: 'INCOME', // Entra a billetera
              fromAccountType: 'ORDER',
              toAccountType: 'WALLET',
              transactionGroupId: distGroupId,
              createdBy: userId,
              notes: `Saldo guardado en billetera virtual | Cédula: ${(order as any).client?.identificationNumber || '—'} | Orden: ${order.receiptNumber} | Pedido: ${order.orderNumber || '—'} | Marca: ${order.brand?.name || '—'} | Tipo: RECARGA`,
              clientDocument: (order as any).client?.identificationNumber,
              balanceBefore: walletBalBefore,
              balanceAfter: walletBalAfter,
              version: 1,
              createdAt: new Date()
            });

            const currentCredit = clientAccountCredits.get(order.clientId) || 0;
            clientAccountCredits.set(order.clientId, currentCredit + creditAmount);
          }
        } else {
          console.log(`   ℹ️ No credit generated (pendingAmount=${pendingAmount.toFixed(2)} >= 0)`);
        }
      }
      
      console.log('\n📊 Summary:');
      console.log(`   orderPayments to insert: ${orderPayments.length}`, orderPayments.map(p => `${p.orderId.substring(0,8)}=$${p.amount}(${p.method})`));
      console.log(`   clientCredits to insert: ${clientCredits.length}`, clientCredits.map(c => `$${c.amount}`));
      console.log(`   clientAccountCredits:`, Object.fromEntries(clientAccountCredits));
      
      console.timeEnd('⏱️ STEP_4_PREPARE');

      // ============================================================================
      // STEP 5: Execute bulk operations
      // ============================================================================
      console.time('⏱️ STEP_5_BULK_OPS');
      
      // Update all orders
      for (const update of orderUpdates) {
        await tx.order.update({
          where: { id: update.id },
          data: update
        });

        // ============================================================================
        // EXCHANGE LOGISTICS SYNC
        // ============================================================================
        
        // A. If it's an exchange order, update the source exchange item status
        const order = ordersMap.get(update.id);
        const exchangeItemId = (order as any).exchangeItemId;
        if (order && exchangeItemId) {
          const exchangeCredit = order.payments.find((p: any) => p.method === 'EXCHANGE_CREDIT')?.amount || 0;
          await tx.orderExchangeItem.update({
            where: { id: exchangeItemId },
            data: { 
              status: 'RECEIVED_FROM_SUPPLIER',
              newValue: update.realInvoiceTotal,
              differenceValue: Number(update.realInvoiceTotal) - Number(exchangeCredit)
            }
          });
        }

        // B. If it's a shadow order (-REV), update the parent ExchangeBatch status to EN_BODEGA
        if (order && order.parentOrderId) {
          const batchItem = await tx.exchangeBatchItem.findFirst({
            where: { orderId: order.parentOrderId },
            select: { batchId: true, batch: { select: { status: true } } }
          });
          
          if (batchItem && batchItem.batch.status === 'ENVIADO') {
            await tx.exchangeBatch.update({
              where: { id: batchItem.batchId },
              data: { 
                status: 'EN_BODEGA',
                receivedAt: new Date()
              }
            });
            console.log(`[Sync] Exchange Batch ${batchItem.batchId} updated to EN_BODEGA because shadow order ${order.receiptNumber} was received`);
          }
        }
      }

      // Bulk insert inventory movements
      if (inventoryMovements.length > 0) {
        await tx.inventoryMovement.createMany({ data: inventoryMovements });
      }

      // Bulk insert order payments
      if (orderPayments.length > 0) {
        await tx.orderPayment.createMany({ data: orderPayments });
      }

      // Bulk insert financial records
      if (financialRecords.length > 0) {
        await tx.financialRecord.createMany({ data: financialRecords });
      }
      
      console.timeEnd('⏱️ STEP_5_BULK_OPS');

      // ============================================================================
      // STEP 6: Update bank accounts (accumulated)
      // ============================================================================
      console.time('⏱️ STEP_6_BANK_ACCOUNTS');
      
      for (const [bankAccountId, totalAmount] of bankAccountTotals) {
        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: {
            currentBalance: { increment: totalAmount },
            updatedAt: new Date(),
            version: { increment: 1 }
          }
        });
      }
      
      console.timeEnd('⏱️ STEP_6_BANK_ACCOUNTS');

      // ============================================================================
      // STEP 7: Handle client credits (accumulated)
      // ============================================================================
      console.time('⏱️ STEP_7_CLIENT_CREDITS');
      
      if (clientCredits.length > 0) {
        // Get unique client IDs
        const clientIds = Array.from(new Set(dto.items.map(i => ordersMap.get(i.orderId)!.clientId)));
        
        // Get or create client accounts
        const existingAccounts = await tx.clientAccount.findMany({
          where: { clientId: { in: clientIds } },
          select: { id: true, clientId: true }
        });
        
        const accountsMap = new Map(existingAccounts.map(a => [a.clientId, a.id]));
        
        // Create missing accounts
        for (const clientId of clientIds) {
          if (!accountsMap.has(clientId)) {
            const newAccount = await tx.clientAccount.create({
              data: {
                clientId,
                totalCreditAvailable: 0,
                totalRewardPoints: 0,
                totalOrders: 0,
                totalSpent: 0,
                rewardLevel: 'BRONCE',
                version: 1
              }
            });
            accountsMap.set(clientId, newAccount.id);
          }
        }

        // Fill clientAccountId in credits
        for (const credit of clientCredits) {
          const order = orders.find(o => o.id === credit.originOrderId);
          if (order) {
            credit.clientAccountId = accountsMap.get(order.clientId)!;
          }
        }

        // Bulk insert credits
        await tx.clientCredit.createMany({ data: clientCredits });

        // Update client accounts (accumulated)
        for (const [clientId, creditAmount] of clientAccountCredits) {
          const accountId = accountsMap.get(clientId)!;
          await tx.clientAccount.update({
            where: { id: accountId },
            data: {
              totalCreditAvailable: { increment: creditAmount },
              updatedAt: new Date(),
              version: { increment: 1 }
            }
          });
        }
      }
      
      console.timeEnd('⏱️ STEP_7_CLIENT_CREDITS');

      console.timeEnd('⏱️ TRANSACTION');

      // ============================================================================
      // STEP 8: Return complete order data for frontend
      // ============================================================================
      const processedOrders: ProcessedOrder[] = dto.items.map(item => {
        const order = ordersMap.get(item.orderId)!;
        const update = orderUpdates.find(u => u.id === item.orderId);
        
        // Combine existing payments with new payments generated in this batch (including distributions)
        const existingPayments = order.payments || [];
        const newPaymentsForThisOrder = orderPayments
          .filter(p => p.orderId === item.orderId)
          .map(p => ({
            ...p,
            amount: Number(p.amount)
          }));

        return {
          id: item.orderId,
          receiptNumber: order.receiptNumber,
          orderNumber: update?.orderNumber || order.orderNumber,
          status: update?.status || order.status,
          clientId: order.clientId,
          clientName: order.clientName,
          brandName: order.brand.name,
          realInvoiceTotal: update?.realInvoiceTotal || Number(order.realInvoiceTotal || order.total),
          invoiceNumber: update?.invoiceNumber || order.invoiceNumber,
          documentType: update?.documentType || order.documentType,
          payments: [...existingPayments, ...newPaymentsForThisOrder] // RETORNAR PAGOS PARA EL PDF
        };
      });

      return {
        success: true,
        batchId: batch.id,
        processedCount: processedOrders.length,
        orders: processedOrders
      };
      
    }, {
      maxWait: 20000,
      timeout: 45000 // Reduced from 90s
    });
  }

  private async handleBatchEdit(tx: any, dto: BatchReceptionDTO, userId: string): Promise<any> {
    // Get existing batch with all its orders
    const batch = await tx.receptionBatch.findUnique({
      where: { id: dto.id },
      select: {
        id: true,
        packingNumber: true,
        orders: {
          select: {
            id: true,
            receiptNumber: true,
            status: true,
            clientId: true
          }
        }
      }
    });

    if (!batch) throw new Error('El lote a editar no existe');

    const oldOrderIds = batch.orders.map((o: any) => o.id);
    const newOrderIds = dto.items.map(i => i.orderId);
    
    // Identify orders to remove completely from batch (not in new items)
    const orderIdsToRemove = oldOrderIds.filter((id: string) => !newOrderIds.includes(id));

    // Validate no delivered orders are being removed or were in the batch
    for (const order of batch.orders) {
      if (order.status === 'ENTREGADO') {
        throw new Error(`No se puede editar el packing porque el pedido ${order.receiptNumber} ya fue entregado.`);
      }
    }

    console.log(`🔄 Reverting previous effects for ${oldOrderIds.length} orders in batch ${batch.id}`);

    // ============================================================================
    // REVERT ALL FINANCIAL EFFECTS FOR ALL ORDERS IN BATCH
    // ============================================================================
    
    // 1. Find all payments created by this reception (Abonos + Distributive Credits)
    const paymentsToRevert = await tx.orderPayment.findMany({
      where: {
        OR: [
          // Basic cash payments during reception
          { orderId: { in: oldOrderIds }, description: 'Abono en recepción de bodega (Packing)' },
          // Distributive payments from orders in this batch (Target is ANY order)
          { reference: { in: oldOrderIds.map((id: string) => `SALDO-DIST-${id}`) } },
          // Distributive payments TO orders in this batch (Source can be ANY order)
          { orderId: { in: oldOrderIds }, method: 'CREDITO_CLIENTE', reference: { startsWith: 'SALDO-DIST-' } }
        ]
      },
      select: { id: true, amount: true, orderId: true, method: true }
    });

    if (paymentsToRevert.length > 0) {
      const paymentIds = paymentsToRevert.map((p: any) => p.id);
      
      // 2. Find financial records associated with these payments
      const recordsToRevert = await tx.financialRecord.findMany({
        where: { orderPaymentId: { in: paymentIds } },
        select: { id: true, bankAccountId: true, amount: true, movementType: true }
      });

      // 3. Find other records (CREDIT_GENERATION, CREDIT_APPLICATION, CASH_RETURN) associated with these orders
      const otherRecords = await tx.financialRecord.findMany({
        where: {
          OR: [
            { orderId: { in: oldOrderIds }, type: { in: ['CREDIT_GENERATION', 'CREDIT_APPLICATION'] } },
            { notes: { contains: `Origen: Pedido` }, type: 'CREDIT_APPLICATION' } // Catch returns/wallet mentions
          ],
          // Match the packing number in notes to be safe
          notes: { contains: batch.packingNumber }
        },
        select: { id: true, bankAccountId: true, amount: true, movementType: true }
      });

      const allRecordsToRevert = [...recordsToRevert, ...otherRecords];

      // 4. Revert Bank Accounts
      const bankReversions = new Map<string, number>();
      for (const rec of allRecordsToRevert) {
        if (rec.bankAccountId === 'virtual-credit-account' || rec.bankAccountId === 'cash-return') continue;
        
        const current = bankReversions.get(rec.bankAccountId) || 0;
        // If it was income, we decrement. If it was expense, we increment.
        const change = rec.movementType === 'INCOME' ? -Number(rec.amount) : Number(rec.amount);
        bankReversions.set(rec.bankAccountId, current + change);
      }

      for (const [bankAccountId, amount] of bankReversions) {
        if (amount === 0) continue;
        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: { currentBalance: { increment: amount }, version: { increment: 1 } }
        });
      }

      // 5. Revert Client Credits (Wallet)
      const creditsToRevert = await tx.clientCredit.findMany({
        where: { originOrderId: { in: oldOrderIds }, status: 'AVAILABLE' },
        select: { id: true, clientAccountId: true, remainingAmount: true }
      });

      if (creditsToRevert.length > 0) {
        const creditReversions = new Map<string, number>();
        for (const credit of creditsToRevert) {
          const current = creditReversions.get(credit.clientAccountId) || 0;
          creditReversions.set(credit.clientAccountId, current + Number(credit.remainingAmount));
        }

        for (const [accountId, amount] of creditReversions) {
          await tx.clientAccount.update({
            where: { id: accountId },
            data: { totalCreditAvailable: { decrement: amount }, version: { increment: 1 } }
          });
        }

        await tx.clientCredit.deleteMany({ where: { id: { in: creditsToRevert.map((c: any) => c.id) } } });
      }

      // 6. Delete all identified records and payments
      if (allRecordsToRevert.length > 0) {
        await tx.financialRecord.deleteMany({ where: { id: { in: allRecordsToRevert.map(r => r.id) } } });
      }
      await tx.orderPayment.deleteMany({ where: { id: { in: paymentIds } } });
    }

    // 7. Delete inventory movements for these orders
    await tx.inventoryMovement.deleteMany({
      where: { orderId: { in: oldOrderIds }, type: 'ENTRY' }
    });

    // 8. Revert orders that are REMOVED from batch
    if (orderIdsToRemove.length > 0) {
      await tx.order.updateMany({
        where: { id: { in: orderIdsToRemove } },
        data: {
          status: 'POR_RECIBIR',
          receptionDate: null,
          receivedByName: null,
          realInvoiceTotal: null,
          invoiceNumber: null,
          documentType: 'FACTURA',
          receptionBatchId: null,
          packingNumber: null,
          packingTotal: null,
          orderNumber: null,
          version: { increment: 1 }
        }
      });
    }

    // Update batch metadata
    return await tx.receptionBatch.update({
      where: { id: dto.id },
      data: {
        packingNumber: dto.packingNumber,
        packingTotal: dto.packingTotal,
        updatedAt: new Date()
      }
    });
  }
}
