import { IOrderRepository } from '../domain/IOrderRepository';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { IBankAccountRepository } from '../../financial/domain/IBankAccountRepository';
import { Order, OrderStatus } from '../domain/Order.entity';
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientCreditBalance } from '../../../shared/utils/financialValidations';

export interface BatchCreateOrderDTO {
  receiptNumber: string;
  clientId: string;
  salesChannel: string;
  createdAt: Date;
  paymentMethod: string;
  bankAccountId?: string;
  transactionDate: Date;
  createdByName?: string;
  initialPayment: {
    amount: number;
    method: string;
    reference?: string;
  };
  creditAmount?: number;
  notes?: string;
  trackingGuide?: string;
  paymentData?: {
    payments: Array<{
      method: string;
      amount: number;
      bankAccountId?: string;
      transactionDate?: string;
      transactionReference?: string;
      notes?: string;
    }>;
    walletCreditUsed: number;
    totalAmount: number;
  };
  orders: Array<{
    brandId: string;
    brandName: string;
    total: number;
    type: string;
    possibleDeliveryDate: Date;
    clientId?: string; // Optional: Override batch clientId
    items: Array<{
      productName: string;
      quantity: number;
      unitPrice: number;
    }>;
    deposit?: number;
    orderNumber?: string;
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

const BLOCKED_PAYMENT_METHODS = ['TRANSFERENCIA', 'DEPOSITO', 'CHEQUE'];

export class BatchCreateOrderUseCase {
  constructor(
    private orderRepository: IOrderRepository,
    private financialRepository: IFinancialRecordRepository,
    private bankAccountRepository: IBankAccountRepository
  ) {}

  async execute(dto: BatchCreateOrderDTO, createdBy: string): Promise<Result<Order[]>> {
    try {
      if (!dto.orders || dto.orders.length === 0) {
        return Result.fail('No orders provided in batch');
      }

      // Validate payment methods — All methods allowed
      if (dto.paymentData?.payments) {
        // Allowing all methods as per latest requirement to unify validation
      }

      // 1. Pre-fetch shared data
      if (!dto.clientId && (!dto.orders || !dto.orders.every(o => o.clientId))) {
        return Result.fail('ID de cliente no especificado');
      }

      const allClientIds = [...new Set([
        ...(dto.clientId ? [dto.clientId] : []),
        ...dto.orders.map(o => o.clientId).filter(Boolean) as string[]
      ])];

      const [clients, lastClosure] = await Promise.all([
        prisma.client.findMany({ where: { id: { in: allClientIds } } }),
        prisma.cashClosure.findFirst({ orderBy: { toDate: 'desc' } })
      ]);

      const mainClient = clients.find(c => c.id === dto.clientId) || clients[0];
      if (!mainClient) return Result.fail('Cliente principal no encontrado');
      
      for (const client of clients) {
        if (client.isBlocked) return Result.fail(`La empresaria ${client.firstName} está bloqueada`);
      }
      
      if (lastClosure && new Date(dto.transactionDate) <= lastClosure.toDate) {
        return Result.fail('Periodo de caja cerrado');
      }

      // Pre-fetch client document for metadata
      const clientDoc = mainClient.identificationNumber || 'S/N';
      
      // 2. Pre-generate order numbers for metadata if missing (Sequential to avoid duplicates)
      const processedOrders: any[] = [];
      for (const o of dto.orders) {
        processedOrders.push({
          ...o,
          actualOrderNumber: o.orderNumber || await this.orderRepository.generateOrderNumber()
        });
      }

      // 2. Validate all brands
      const brandIds = [...new Set(dto.orders.map(o => o.brandId))];
      const brands = await prisma.brand.findMany({
        where: { id: { in: brandIds } }
      });

      for (const brandId of brandIds) {
        const brand = brands.find(b => b.id === brandId);
        if (!brand || !brand.isActive) {
          return Result.fail(`La marca ${brand?.name || brandId} no está activa`);
        }
      }

      // 2.5 Validate strict exchange source logic (Option B)
      const sourceOrderIds = dto.orders.map(o => o.sourceOrderId).filter(id => id) as string[];
      if (sourceOrderIds.length > 0) {
        const existingExchanges = await prisma.order.findMany({
          where: { sourceOrderId: { in: sourceOrderIds } },
          select: { sourceOrderId: true, orderNumber: true }
        });

        if (existingExchanges.length > 0) {
          const duplicatedSourceIds = existingExchanges.map(e => e.sourceOrderId) as string[];
          const sourceOrders = await prisma.order.findMany({
            where: { id: { in: duplicatedSourceIds } },
            select: { orderNumber: true }
          });
          const conflictNames = sourceOrders.map(so => so.orderNumber).join(", ");
          return Result.fail(`Doble devolución detectada: Las prendas de origen (${conflictNames}) ya fueron cambiadas anteriormente en otra guía.`);
        }
      }

      // If no receipt number provided, generate a unique "Sin Número" (S/N) guide so they can be grouped/edited later
      // But we show it as empty in the UI. We use a UUID to ensure uniqueness even if multiple are 'empty'
      const receiptNumber = dto.receiptNumber && dto.receiptNumber.trim() 
        ? dto.receiptNumber 
        : `SN-${crypto.randomUUID().slice(0, 8)}`;

      // 3. Prepare all entities
      let parentId: string | undefined = undefined;

      const resultOrders = await prisma.$transaction(async (tx) => {
        // ============================================================================
        // OPTIMIZACIÓN: Preparar todos los datos ANTES de ejecutar queries
        // ============================================================================
        
        // 1. Crear/Verificar OrderReceipt
        let receiptId: string;
        const existingReceipt = await (tx as any).orderReceipt.findUnique({
          where: { receiptNumber }
        });

        const clientNameForReceipt = (mainClient as any).lastName 
          ? `${mainClient.firstName} ${(mainClient as any).lastName}`
          : mainClient.firstName;

        if (existingReceipt) {
          receiptId = existingReceipt.id;
          // Update header info even if exists (e.g. updating a draft)
          await (tx as any).orderReceipt.update({
            where: { id: receiptId },
            data: {
              salesChannel: dto.salesChannel,
              transactionDate: dto.transactionDate,
              paymentMethod: dto.paymentMethod,
              bankAccountId: dto.bankAccountId || null,
              notes: dto.notes || existingReceipt.notes,
              version: { increment: 1 }
            }
          });
        } else {
          receiptId = crypto.randomUUID();
          
          let receiptCreatedAt = dto.createdAt ? new Date(dto.createdAt) : new Date();
          const now = new Date();
          if (receiptCreatedAt.getHours() === 0 && receiptCreatedAt.getMinutes() === 0 && receiptCreatedAt.toDateString() === now.toDateString()) {
             receiptCreatedAt = now;
          }

          await (tx as any).orderReceipt.create({
            data: {
              id: receiptId,
              receiptNumber,
              clientId: dto.clientId,
              clientName: clientNameForReceipt,
              salesChannel: dto.salesChannel,
              createdAt: receiptCreatedAt,
              transactionDate: dto.transactionDate,
              paymentMethod: dto.paymentMethod,
              bankAccountId: dto.bankAccountId || null,
              transactionReference: dto.initialPayment?.reference || null,
              notes: dto.notes || null,
              createdByName: dto.createdByName || createdBy,
              version: 1
            }
          });
        }

        // 2. Generar consecutivos de abonos (fuera del loop)
        const lastPayment = await prisma.orderPayment.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { receiptNumber: true }
        });

        let nextPaymentNumber = 1;
        if (lastPayment && lastPayment.receiptNumber && lastPayment.receiptNumber.startsWith('AB')) {
          nextPaymentNumber = parseInt(lastPayment.receiptNumber.replace('AB', '')) + 1;
        }

        // ============================================================================
        // OPTIMIZACIÓN: Preparar TODOS los datos en arrays
        // ============================================================================
        const allOrders: any[] = [];
        const allItems: any[] = [];
        const allPayments: any[] = [];
        const allFinancialRecords: any[] = [];
        const paymentIdMap = new Map<string, string>(); // orderId -> paymentId
        let totalBankIncrement = 0;
        const accountBalancesMap = new Map<string, number>();
        let clientWalletRunningBal: number | null = null;
        let firstSplitPaymentId: string | undefined = undefined; // track first order's split payment for FR linkage

        let orderCreatedAt = dto.createdAt ? new Date(dto.createdAt) : new Date();
        const now = new Date();
        if (orderCreatedAt.getHours() === 0 && orderCreatedAt.getMinutes() === 0 && orderCreatedAt.toDateString() === now.toDateString()) {
           orderCreatedAt = now;
        }

        for (let i = 0; i < processedOrders.length; i++) {
          const orderDto = processedOrders[i];
          const orderId = crypto.randomUUID();
          
          if (i === 0) parentId = orderId;

          const currentClientId = orderDto.clientId || dto.clientId;
          const currentClient = clients.find(c => c.id === currentClientId);
          if (!currentClient) throw new Error(`Cliente ${currentClientId} no encontrado`);
          
          const currentClientName = (currentClient as any).lastName 
            ? `${currentClient.firstName} ${(currentClient as any).lastName}`
            : currentClient.firstName;

          const firstItem = orderDto.items?.[0];
            const orderData: any = {
            id: orderId,
            receiptNumber: receiptNumber,
            clientId: currentClientId,
            clientName: currentClientName,
            salesChannel: dto.salesChannel,
            type: orderDto.type,
            brandId: orderDto.brandId,
            total: Number(orderDto.total),
            paymentMethod: dto.paymentMethod,
            bankAccountId: dto.bankAccountId || null,
            transactionDate: dto.transactionDate,
            possibleDeliveryDate: orderDto.possibleDeliveryDate,
            status: orderDto.status || (orderDto.type === 'CAMBIO' ? OrderStatus.POR_ENVIAR : OrderStatus.POR_RECIBIR),
            parentOrderId: i > 0 ? parentId : null,
            receiptId: receiptId,
            notes: orderDto.notes || dto.notes,
            orderNumber: orderDto.orderNumber || orderDto.actualOrderNumber, // Ensure orderNumber is saved
            createdByName: createdBy,
            createdAt: orderCreatedAt,
            version: 1,
            sourceOrderId: orderDto.sourceOrderId,
            sourceOrderNumber: orderDto.sourceOrderNumber,
            sourceBrandName: orderDto.sourceBrandName,
            sourceQuantity: orderDto.sourceQuantity,
            sourceDescription: orderDto.sourceDescription,
            description: orderDto.description,
            trackingGuide: dto.trackingGuide,
          };
          allOrders.push(orderData);

          // Preparar Items
          orderDto.items.forEach((item: any) => {
            allItems.push({
              id: crypto.randomUUID(),
              orderId: orderId,
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              brandId: orderDto.brandId,
              brandName: orderDto.brandName
            });
          });

          // Preparar Payments (múltiples métodos de pago o abono simple)
          if (dto.paymentData && dto.paymentData.payments && dto.paymentData.payments.length > 0) {
            // SPLIT PAYMENT: Crear un OrderPayment por pedido con su depósito individual
            // Los FinancialRecords se crean FUERA del loop (uno por método de pago)
            const rowDeposit = Number(orderDto.deposit || 0);
            if (rowDeposit > 0) {
              const paymentId = crypto.randomUUID();
              // Track the first order's paymentId so FRs can be linked to it
              if (i === 0) firstSplitPaymentId = paymentId;
              allPayments.push({
                id: paymentId,
                orderId: orderId,
                amount: rowDeposit,
                method: 'SPLIT_PAYMENT',
                receiptNumber: `AB${(nextPaymentNumber++).toString().padStart(3, '0')}`,
                description: `Split payment - ${receiptNumber} (fila ${i + 1})`,
                createdAt: new Date()
              });
            }
          } else {
            // Lógica original para abono simple por fila
            console.log(`[BatchCreateOrder] Simple payment flow - paymentMethod: ${dto.paymentMethod}, creditAmount: ${dto.creditAmount}`);
            
            const rowDeposit = Number(orderDto.deposit || 0);
            
            if (rowDeposit > 0) {
              const paymentId = crypto.randomUUID();
              paymentIdMap.set(orderId, paymentId);

              if (dto.paymentMethod === 'BILLETERA_VIRTUAL') {
                console.log(`[BatchCreateOrder] Creating financial record and order payment for simple BILLETERA_VIRTUAL payment on row ${i}`);
                
                // Buscar el crédito más antiguo (FIFO) y obtener el bankAccountId de su FinancialRecord de origen
                let walletBankId: string | null = null;
                const oldestCredit = await tx.clientCredit.findFirst({
                  where: {
                    clientAccount: { clientId: dto.clientId },
                    status: 'AVAILABLE',
                    remainingAmount: { gt: 0 }
                  },
                  orderBy: { createdAt: 'asc' },
                  select: { originTransactionId: true }
                });
                
                if (oldestCredit?.originTransactionId) {
                  const originFR = await tx.financialRecord.findUnique({
                    where: { id: oldestCredit.originTransactionId },
                    select: { bankAccountId: true }
                  });
                  if (originFR?.bankAccountId) walletBankId = originFR.bankAccountId;
                }
                
                // Fallback: buscar una cuenta de tipo CASH
                if (!walletBankId) {
                  const cashAccount = await tx.bankAccount.findFirst({
                    where: { type: 'CASH', isActive: true },
                    select: { id: true }
                  });
                  if (cashAccount) walletBankId = cashAccount.id;
                }
                
                if (!walletBankId) {
                  console.error(`[BatchCreateOrder] ERROR: Could not find bankAccountId for wallet payment - FR will NOT be created!`);
                } else {
                  // Capture wallet balance snapshot
                  if (clientWalletRunningBal === null) {
                    const clientAccount = await tx.clientAccount.findUnique({
                      where: { clientId: dto.clientId },
                      select: { totalCreditAvailable: true }
                    });
                    clientWalletRunningBal = Number(clientAccount?.totalCreditAvailable || 0);
                  }
                  
                  const balanceBefore: number = clientWalletRunningBal!;
                  const balanceAfter: number = balanceBefore - rowDeposit;
                  clientWalletRunningBal = balanceAfter;

                  allFinancialRecords.push({
                    id: crypto.randomUUID(),
                    type: 'PAYMENT',
                    source: 'ORDER_PAYMENT',
                    movementType: 'INTERNAL',
                    fromAccountType: 'WALLET',
                    toAccountType: 'ORDER',
                    referenceNumber: `REF-WALLET-SIMPLE-${Date.now()}-${i}`,
                    userReference: receiptNumber,
                    amount: rowDeposit,
                    date: new Date(),
                    clientId: currentClientId,
                    clientName: currentClientName,
                    orderId: orderId,
                    orderPaymentId: paymentId,
                    createdBy,
                    notes: JSON.stringify({
                      v: 2,
                    title: orderDto.type === 'CATALOGO' ? 'VENTA_CATALOGO' : 'USO_BILLETERA',
                    module: 'ORDERS',
                    description: dto.notes || 'Abono inicial con Billetera Virtual',
                    orders: [{ receiptNumber: receiptNumber, orderNumber: orderDto.orderNumber, brandName: orderDto.brandName, type: orderDto.type }]
                    }),
                    bankAccountId: walletBankId,
                    paymentMethod: 'BILLETERA_VIRTUAL',
                    balanceBefore: balanceBefore,
                    balanceAfter: balanceAfter,
                    clientDocument: currentClient.identificationNumber || 'S/N',
                    version: 1
                  });
                }

                // Payment de crédito para esta orden (flujo simple)
                allPayments.push({
                  id: paymentId,
                  orderId: orderId,
                  amount: rowDeposit,
                  method: 'CREDITO_CLIENTE',
                  receiptNumber: `AB${(nextPaymentNumber++).toString().padStart(3, '0')}`,
                  description: dto.notes ? `Saldo a favor aplicado: ${dto.notes}` : 'Saldo a favor aplicado',
                  createdAt: new Date()
                });

              } else {
                // Flujos Cash / Bank (EFECTIVO, TRANSFERENCIA, DEPOSITO, CHEQUE)
                allPayments.push({
                  id: paymentId,
                  orderId: orderId,
                  amount: rowDeposit,
                  method: dto.paymentMethod,
                  reference: dto.initialPayment?.reference || undefined,
                  receiptNumber: `AB${(nextPaymentNumber++).toString().padStart(3, '0')}`,
                  description: dto.notes || `Abono inicial (fila ${i + 1})`,
                  createdAt: new Date()
                });

                // Preparar FinancialRecord
                const simpleBankId = dto.bankAccountId && dto.bankAccountId.trim() ? dto.bankAccountId.trim() : null;
                if (!simpleBankId) {
                  throw new Error(`Cuenta bancaria requerida para el método de pago ${dto.paymentMethod}`);
                }
                
                // Capture bank balance snapshot BEFORE the payment
                if (!accountBalancesMap.has(simpleBankId)) {
                  const bankAcc = await tx.bankAccount.findUnique({
                    where: { id: simpleBankId },
                    select: { currentBalance: true }
                  });
                  accountBalancesMap.set(simpleBankId, Number(bankAcc?.currentBalance || 0));
                }
                
                const balanceBefore: number = accountBalancesMap.get(simpleBankId)!;
                const balanceAfter: number = balanceBefore + rowDeposit;
                accountBalancesMap.set(simpleBankId, balanceAfter);
                
                allFinancialRecords.push({
                  id: crypto.randomUUID(),
                  type: 'PAYMENT',
                  source: 'ORDER_PAYMENT',
                  movementType: 'INCOME',
                  fromAccountType: 'EXTERNAL',
                  toAccountType: 'CASH',
                  referenceNumber: `REF-INI-${Date.now()}-${i}-${Math.random().toString(36).substring(7)}`,
                  userReference: (dto.paymentMethod !== 'EFECTIVO' && dto.initialPayment?.reference)
                    ? dto.initialPayment.reference
                    : `AB${(nextPaymentNumber - 1).toString().padStart(3, '0')}`,
                  amount: rowDeposit,
                  date: new Date(),
                  clientId: currentClientId,
                  clientName: currentClientName,
                  orderId: orderId,
                  orderPaymentId: paymentId,
                  createdBy,
                  notes: JSON.stringify({
                    v: 2,
                    title: orderDto.type === 'CATALOGO' ? 'VENTA_CATALOGO' : (
                             dto.paymentMethod === 'TRANSFERENCIA' ? 'TRANSFERENCIA_BANCARIA' :
                             dto.paymentMethod === 'DEPOSITO' ? 'DEPOSITO_BANCARIO' :
                             dto.paymentMethod === 'CHEQUE' ? 'PAGO_CHEQUE' : 'PAGO_EFECTIVO'),
                    module: 'ORDERS',
                    description: dto.notes || 'Abono inicial de pedido',
                    orders: [{ receiptNumber: receiptNumber, orderNumber: orderDto.orderNumber, brandName: orderDto.brandName, type: orderDto.type }]
                  }),
                  bankAccountId: simpleBankId,
                  paymentMethod: dto.paymentMethod,
                  balanceBefore: balanceBefore,
                  balanceAfter: balanceAfter,
                  clientDocument: currentClient.identificationNumber || 'S/N',
                  version: 1
                });

                totalBankIncrement += rowDeposit;

                // Soporte Legacy: si es pago Cash pero existe creditAmount
                if (i === 0 && dto.creditAmount && dto.creditAmount > 0) {
                  allPayments.push({
                    id: crypto.randomUUID(),
                    orderId: orderId,
                    amount: Number(dto.creditAmount),
                    method: 'CREDITO_CLIENTE',
                    receiptNumber: `AB${(nextPaymentNumber++).toString().padStart(3, '0')}`,
                    description: 'Saldo a favor aplicado (Legado)',
                    createdAt: new Date()
                  });
                }
              }
            }
          }
        }

        // ============================================================================
        // SPLIT PAYMENT: Crear FinancialRecords por método de pago (fuera del loop)
        // Un FinancialRecord por método, independiente de la distribución por pedido
        const splitBankIncrements = new Map<string, number>(); // bankAccountId -> totalAmount

        if (dto.paymentData && dto.paymentData.payments && dto.paymentData.payments.length > 0) {
          console.log(`[BatchCreateOrder] Processing split payment with ${dto.paymentData.payments.length} payment methods`);
          console.log(`[BatchCreateOrder] dto.bankAccountId: ${dto.bankAccountId}`);
          
          for (let paymentIndex = 0; paymentIndex < dto.paymentData.payments.length; paymentIndex++) {
            const paymentItem = dto.paymentData.payments[paymentIndex];
            const paymentAmount = Number(paymentItem.amount || 0);

            console.log(`[BatchCreateOrder] Payment ${paymentIndex + 1}: method=${paymentItem.method}, amount=${paymentAmount}`);

            if (paymentAmount <= 0) continue;

            if (paymentItem.method !== 'BILLETERA_VIRTUAL') {
              // Normalize bankAccountId — empty string is treated as missing
              // Support both camelCase (bankAccountId) and snake_case (bank_account_id) from frontend
              const rawBankId = (paymentItem as any).bank_account_id || paymentItem.bankAccountId;
              const bankId = (rawBankId && typeof rawBankId === 'string' && rawBankId.trim())
                ? rawBankId.trim()
                : (dto.bankAccountId && dto.bankAccountId.trim() ? dto.bankAccountId.trim() : null);

              if (!bankId) {
                throw new Error(`Cuenta bancaria requerida para el método de pago ${paymentItem.method}`);
              }

              // Capture bank balance snapshot BEFORE the payment is processed
              if (!accountBalancesMap.has(bankId)) {
                const bankAcc = await tx.bankAccount.findUnique({
                  where: { id: bankId },
                  select: { currentBalance: true }
                });
                accountBalancesMap.set(bankId, Number(bankAcc?.currentBalance || 0));
              }
              
              const balanceBefore: number = accountBalancesMap.get(bankId)!;
              const balanceAfter: number = balanceBefore + paymentAmount;
              accountBalancesMap.set(bankId, balanceAfter);

              // Build notes logically
              let notesOrders = dto.orders.map(o => ({ receiptNumber, orderNumber: o.orderNumber, brandName: o.brandName, type: o.type }));

              allFinancialRecords.push({
                id: crypto.randomUUID(),
                type: 'PAYMENT',
                source: 'ORDER_PAYMENT',
                movementType: 'INCOME',
                fromAccountType: 'EXTERNAL',
                toAccountType: 'CASH',
                referenceNumber: `REF-SPL-${Date.now()}-${paymentIndex}`,
                userReference: paymentItem.method !== 'EFECTIVO' && (paymentItem.transactionReference || (paymentItem as any).transaction_reference)
                  ? (paymentItem.transactionReference || (paymentItem as any).transaction_reference)
                  : `AB-SPL-${receiptNumber}`,
                amount: paymentAmount,
                date: new Date(),
                clientId: dto.clientId,
                clientName: clientNameForReceipt,
                // Link to the first order's split payment so the UI can find these FRs
                orderPaymentId: firstSplitPaymentId || undefined,
                orderId: dto.orders.length === 1 ? allOrders[0].id : null,
                createdBy,
                notes: JSON.stringify({
                  v: 2,
                  title: dto.orders.some(o => o.type === 'CATALOGO') ? 'VENTA_CATALOGO' : (
                         paymentItem.method === 'TRANSFERENCIA' ? 'TRANSFERENCIA_BANCARIA' :
                         paymentItem.method === 'DEPOSITO' ? 'DEPOSITO_BANCARIO' :
                         paymentItem.method === 'CHEQUE' ? 'PAGO_CHEQUE' : 
                         paymentItem.method === 'BILLETERA_VIRTUAL' ? 'USO_BILLETERA' : 'PAGO_EFECTIVO'),
                  module: 'ORDERS',
                  description: paymentItem.notes || dto.notes || 'Abono inicial (Múltiple)',
                  orders: notesOrders
                }),
                bankAccountId: bankId,
                paymentMethod: paymentItem.method,
                balanceBefore: balanceBefore,
                balanceAfter: balanceAfter,
                clientDocument: mainClient.identificationNumber || 'S/N',
                version: 1
              });

              // Acumular por cuenta bancaria (puede haber múltiples métodos en la misma cuenta)
              splitBankIncrements.set(bankId, (splitBankIncrements.get(bankId) || 0) + paymentAmount);
            } else {
              // BILLETERA_VIRTUAL: WALLET → ORDER (internal transfer)
              console.log(`[BatchCreateOrder] Processing BILLETERA_VIRTUAL payment:`);
              console.log(`  - paymentAmount: ${paymentAmount}`);
              
              // Buscar el crédito más antiguo (FIFO) y su FinancialRecord de origen
              const oldestCredit = await tx.clientCredit.findFirst({
                where: {
                  clientAccount: { clientId: dto.clientId },
                  status: 'AVAILABLE',
                  remainingAmount: { gt: 0 }
                },
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  originTransactionId: true
                }
              });
              
              let walletBankId: string | null = null;
              
              if (oldestCredit?.originTransactionId) {
                // Buscar el FinancialRecord que generó este crédito
                const originFR = await tx.financialRecord.findUnique({
                  where: { id: oldestCredit.originTransactionId },
                  select: { bankAccountId: true }
                });
                
                if (originFR?.bankAccountId) {
                  walletBankId = originFR.bankAccountId;
                  console.log(`  - Using bankAccountId from origin FR: ${walletBankId}`);
                } else {
                  console.log(`  - Origin FR found but no bankAccountId`);
                }
              } else {
                console.log(`  - No credit found with originTransactionId`);
              }
              
              // Fallback: buscar una cuenta de tipo CASH
              if (!walletBankId) {
                console.log(`  - Trying to find any CASH account as fallback`);
                const cashAccount = await tx.bankAccount.findFirst({
                  where: { type: 'CASH', isActive: true },
                  select: { id: true }
                });
                
                if (cashAccount) {
                  walletBankId = cashAccount.id;
                  console.log(`  - Using CASH account as fallback: ${walletBankId}`);
                }
              }
              
              if (!walletBankId) {
                console.error(`[BatchCreateOrder] ERROR: Could not find bankAccountId for wallet payment - FR will NOT be created!`);
              } else {
                console.log(`[BatchCreateOrder] Creating financial record for wallet payment...`);
                
                // Capture wallet balance snapshot BEFORE the payment is processed
                if (clientWalletRunningBal === null) {
                  const clientAccount = await tx.clientAccount.findUnique({
                    where: { clientId: dto.clientId },
                    select: { totalCreditAvailable: true }
                  });
                  clientWalletRunningBal = Number(clientAccount?.totalCreditAvailable || 0);
                }
                
                const balanceBefore: number = clientWalletRunningBal!;
                const balanceAfter: number = balanceBefore - paymentAmount;
                clientWalletRunningBal = balanceAfter;

                let notesOrders = dto.orders.map(o => ({ receiptNumber, orderNumber: o.orderNumber, brandName: o.brandName, type: o.type }));

                allFinancialRecords.push({
                  id: crypto.randomUUID(),
                  type: 'PAYMENT',
                  source: 'ORDER_PAYMENT',
                  movementType: 'INTERNAL',
                  fromAccountType: 'WALLET',
                  toAccountType: 'ORDER',
                  referenceNumber: `REF-WALLET-${Date.now()}-${paymentIndex}`,
                  userReference: receiptNumber,
                  amount: paymentAmount,
                  date: new Date(),
                  clientId: dto.clientId,
                  clientName: clientNameForReceipt,
                  orderPaymentId: firstSplitPaymentId || undefined,
                  orderId: dto.orders.length === 1 ? allOrders[0].id : null,
                  createdBy,
                  notes: JSON.stringify({
                    v: 2,
                    title: dto.orders.some(o => o.type === 'CATALOGO') ? 'VENTA_CATALOGO' : 'USO_BILLETERA',
                    module: 'ORDERS',
                    description: paymentItem.notes || dto.notes || 'Abono inicial con Billetera Virtual (Múltiple)',
                    orders: notesOrders
                  }),
                  bankAccountId: walletBankId,
                  paymentMethod: 'BILLETERA_VIRTUAL',
                  balanceBefore: balanceBefore,
                  balanceAfter: balanceAfter,
                  clientDocument: mainClient.identificationNumber || 'S/N',
                  version: 1
                });
                
                console.log(`[BatchCreateOrder] Financial record added to batch (will be created with createMany)`);
              }
            }
          }
        }

        // ============================================================================
        // OPTIMIZACIÓN: Ejecutar BULK INSERTS
        // ============================================================================
        
        // 3. Crear todos los Orders de una vez
        await tx.order.createMany({ data: allOrders });

        // 4. Crear todos los Items de una vez
        if (allItems.length > 0) {
          await tx.orderItem.createMany({ data: allItems });
        }

        // 5. Crear todos los Payments de una vez
        if (allPayments.length > 0) {
          await tx.orderPayment.createMany({ data: allPayments });
        }

        // 6. Crear todos los FinancialRecords de una vez
        if (allFinancialRecords.length > 0) {
          await tx.financialRecord.createMany({ data: allFinancialRecords });
        }

        // 6.5 Update source orders status to CAMBIADO (Prevents re-exchanging)
        if (sourceOrderIds.length > 0) {
          await tx.order.updateMany({
            where: { id: { in: sourceOrderIds } },
            data: { status: 'CAMBIADO', updatedAt: new Date(), version: { increment: 1 } }
          });
        }

        // 7. Actualizar BankAccount(s)
        // Modo split: actualizar cada cuenta bancaria involucrada
        if (splitBankIncrements.size > 0) {
          for (const [bankId, amount] of splitBankIncrements.entries()) {
            if (!bankId || amount <= 0) continue;

            const bankAccount = await tx.bankAccount.findUnique({
              where: { id: bankId },
              select: { id: true, currentBalance: true, version: true, name: true }
            });

            if (!bankAccount) throw new Error(`Bank account ${bankId} not found`);

            validateBankAccountBalance(Number(bankAccount.currentBalance), amount, bankId, bankAccount.name);

            const result = await tx.bankAccount.updateMany({
              where: { id: bankId, version: bankAccount.version },
              data: { currentBalance: { increment: amount }, updatedAt: new Date(), version: { increment: 1 } }
            });

            if (result.count === 0) {
              throw new ConcurrencyError('Bank account was modified by another transaction. Please retry.', 'BankAccount', bankId);
            }
          }
        } else if (totalBankIncrement > 0 && dto.bankAccountId && dto.paymentMethod !== 'BILLETERA_VIRTUAL') {
          // Modo simple: una sola cuenta bancaria
          const bankAccount = await tx.bankAccount.findUnique({
            where: { id: dto.bankAccountId },
            select: { id: true, currentBalance: true, version: true, name: true }
          });

          if (!bankAccount) {
            throw new Error(`Bank account ${dto.bankAccountId} not found`);
          }

          validateBankAccountBalance(
            Number(bankAccount.currentBalance),
            totalBankIncrement,
            dto.bankAccountId,
            bankAccount.name
          );

          const result = await tx.bankAccount.updateMany({
            where: {
              id: dto.bankAccountId,
              version: bankAccount.version
            },
            data: { 
              currentBalance: { increment: totalBankIncrement },
              updatedAt: new Date(),
              version: { increment: 1 }
            }
          });

          if (result.count === 0) {
            throw new ConcurrencyError(
              'Bank account was modified by another transaction. Please retry.',
              'BankAccount',
              dto.bankAccountId
            );
          }
        }

        // 8. Aplicar crédito a favor (solo una vez)
        // En modo split: usar el monto de BILLETERA_VIRTUAL del paymentData
        // En modo simple: usar creditAmount del DTO
        const walletAmount = dto.paymentData?.payments
          ? dto.paymentData.payments
              .filter((p: any) => p.method === 'BILLETERA_VIRTUAL')
              .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0)
          : (dto.creditAmount || 0);

        if (walletAmount > 0) {
          const availableCredits = await tx.clientCredit.findMany({
            where: { clientAccount: { clientId: dto.clientId }, status: 'AVAILABLE' },
            select: {
              id: true,
              remainingAmount: true,
              version: true,
              status: true
            },
            orderBy: { createdAt: 'asc' }
          });
          
          let rem = walletAmount;
          const creditsToUpdate: Array<Promise<void>> = [];
          
          for (const cr of availableCredits) {
            if (rem <= 0) break;
            const sub = Math.min(Number(cr.remainingAmount), rem);
            
            validateClientCreditBalance(Number(cr.remainingAmount), sub, cr.id);

            const newRemaining = Number(cr.remainingAmount) - sub;
            const newStatus = newRemaining <= 0.01 ? 'USED' : 'AVAILABLE';
            
            creditsToUpdate.push((async () => {
              const result = await tx.clientCredit.updateMany({
                where: { id: cr.id, version: cr.version },
                data: { remainingAmount: newRemaining, status: newStatus, version: { increment: 1 } }
              });

              if (result.count === 0) {
                throw new ConcurrencyError('Client credit was modified by another transaction. Please retry.', 'ClientCredit', cr.id);
              }
            })());
            
            rem -= sub;
          }

          if (rem > 0.01) {
            throw new Error(`Saldo insuficiente en billetera virtual. Falta: ${rem.toFixed(2)}`);
          }
          
          await Promise.all(creditsToUpdate);

          // Actualizar ClientAccount.totalCreditAvailable
          const clientAccount = await tx.clientAccount.findUnique({
            where: { clientId: dto.clientId },
            select: { id: true, totalCreditAvailable: true, version: true }
          });
          if (clientAccount) {
            await tx.clientAccount.updateMany({
              where: { id: clientAccount.id, version: clientAccount.version },
              data: { totalCreditAvailable: { decrement: walletAmount }, version: { increment: 1 } }
            });
          }
        }

        // 9. Actualizar cliente
        const lastOrder = dto.orders[dto.orders.length - 1];
        await tx.client.update({
          where: { id: dto.clientId },
          data: {
            lastOrderDate: new Date(),
            lastBrandName: lastOrder.brandName
          }
        });

        // 10. Recuperar los orders creados con sus relaciones para la respuesta
        const createdOrders = await tx.order.findMany({
          where: { id: { in: allOrders.map(o => o.id) } },
          include: {
            items: true,
            payments: {
              include: {
                financialRecords: true
              }
            },
            brand: true
          }
        });

        // Deterministic sort using the sequence from our prepared array
        const idToIndexMap = new Map(allOrders.map((o, idx: number) => [o.id, idx]));
        createdOrders.sort((a: any, b: any) => (idToIndexMap.get(a.id) ?? 0) - (idToIndexMap.get(b.id) ?? 0));

        return createdOrders;
      }, {
        maxWait: 20_000,
        timeout: 60_000
      });

      // Map to Domain Entities
      const domainOrders = resultOrders.map(raw => Order.create({
          receiptNumber: raw.receiptNumber,
          salesChannel: raw.salesChannel,
          type: raw.type,
          brandId: raw.brandId,
          brandName: (raw as any).brand?.name || 'Sin marca',
          total: raw.total ? Number(raw.total) : 0,
          paymentMethod: raw.paymentMethod,
          bankAccountId: raw.bankAccountId || undefined,
          transactionDate: raw.transactionDate,
          possibleDeliveryDate: raw.possibleDeliveryDate,
          status: raw.status as any,
          parentOrderId: raw.parentOrderId || undefined,
          orderNumber: raw.orderNumber || undefined,
          trackingGuide: raw.trackingGuide || undefined,
          clientId: raw.clientId,
          clientName: raw.clientName,
          notes: raw.notes || undefined,
          items: raw.items.map((i: any) => ({
            id: i.id,
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice ? Number(i.unitPrice) : 0,
            brandId: i.brandId,
            brandName: i.brandName
          })),
          payments: (raw.payments || []).map((p: any) => ({
            id: p.id,
            amount: p.amount ? Number(p.amount) : 0,
            method: p.method,
            reference: p.reference || undefined,
            description: p.description || undefined,
            createdAt: p.createdAt,
            financialRecords: p.financialRecords
          })),
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
          version: raw.version
      }, raw.id));

      return Result.ok(domainOrders);
    } catch (error: any) {
      console.error('BatchCreateOrderUseCase Error:', error);
      
      // Manage Prisma unique constraint errors (P2002)
      if (error.code === 'P2002') {
        const target = (error.meta?.target as string[]) || [];
        if (target.includes('receipt_number')) {
          return Result.fail(`El número de guía ${dto.receiptNumber} ya existe en el sistema.`);
        }
        return Result.fail("Ya existe un registro con estos datos únicos.");
      }

      return Result.fail(error instanceof Error ? error.message : 'Batch creation failed');
    }
  }
}
