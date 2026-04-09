import { IOrderRepository } from '../domain/IOrderRepository';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { IBankAccountRepository } from '../../financial/domain/IBankAccountRepository';
import { Order, OrderStatus } from '../domain/Order.entity';
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientAccountCredit } from '../../../shared/utils/financialValidations';
import { buildNotesJSON, cardTitleFromMethod, generateGroupId } from '../../../shared/utils/transactionNotes';
import crypto from 'crypto';

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
  idempotencyKey?: string;
  orders: Array<{
    brandId: string;
    brandName: string;
    total: number;
    type: string;
    possibleDeliveryDate: Date;
    clientId?: string;
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

export class BatchCreateOrderUseCase {
  constructor(
    private orderRepository: IOrderRepository,
    private financialRepository: IFinancialRecordRepository,
    private bankAccountRepository: IBankAccountRepository
  ) {}

  async execute(dto: BatchCreateOrderDTO, createdBy: string): Promise<Result<Order[]>> {
    let retryCount = 0;
    const MAX_RETRIES = 3;

    while (retryCount < MAX_RETRIES) {
      try {
        return await this.performTransaction(dto, createdBy, retryCount);
      } catch (err: any) {
        const isConcurrencyError = err.code === 'P2002' || err.message === 'CONCURRENCY_RETRY';
        
        if (isConcurrencyError && retryCount < MAX_RETRIES - 1) {
          console.warn(`[BatchCreateOrder] Concurrency detected (attempt ${retryCount + 1}). Retrying...`);
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
          continue;
        }
        
        console.error('[BatchCreateOrder] Final failure after retries:', err);
        return Result.fail(err.message || 'Error al procesar el lote de pedidos');
      }
    }
    return Result.fail('Error de concurrencia después de múltiples intentos');
  }

  private async performTransaction(dto: BatchCreateOrderDTO, createdBy: string, retryCount: number = 0): Promise<Result<Order[]>> {
    const clients = await prisma.client.findMany({ where: { id: { in: [dto.clientId] } } });
    const mainClient = clients.find(c => c.id === dto.clientId);
    if (!mainClient) return Result.fail('Cliente no encontrado');

    const receiptNumber = (dto.receiptNumber || `SN-${crypto.randomUUID().slice(0, 8)}`).trim();
    const transactionGroupId = generateGroupId();

    const resultOrders = await prisma.$transaction(async (tx): Promise<any[]> => {
      // 0. Idempotency Check
      if (dto.idempotencyKey) {
        const existing = await tx.financialRecord.findFirst({
          where: { idempotencyKey: dto.idempotencyKey } as any
        });
        if (existing) {
          console.warn(`[BatchCreateOrder] Idempotent request detected: ${dto.idempotencyKey}`);
          return []; 
        }
      }

      // Context
      const clientAccount = await tx.clientAccount.findUnique({ where: { clientId: dto.clientId } });
      let currentWalletRunningBalance = Number(clientAccount?.totalCreditAvailable || 0);

      // Track bank account balances to calculate balanceBefore/After if multiple payments go to same account
      const bankAccountBalances = new Map<string, number>();

      const allOrders: any[] = [];
      const allPayments: any[] = [];
      const allFinancialRecords: any[] = [];

      const clientDoc = mainClient.identificationNumber || 'S/N';
      const clientName = mainClient.firstName.trim();
      const orderBrandNames = new Map<string, string>();

      // 1. Create OrderReceipt
      const receipt = await tx.orderReceipt.create({
        data: {
          receiptNumber,
          clientId: dto.clientId,
          clientName,
          salesChannel: dto.salesChannel,
          transactionDate: dto.transactionDate || new Date(),
          paymentMethod: dto.paymentMethod,
          bankAccountId: dto.bankAccountId,
          transactionReference: (dto as any).transactionReference,
          notes: dto.notes,
          createdByName: (dto as any).createdBy || 'admin'
        }
      });
      const receiptId = receipt.id;

      // 2. Prepare Order Number Sequence
      let nextOrderNumber = 0;
      let orderPrefix = `PD-${new Date().getFullYear()}-`;
      
      const lastOrderNumStr = await this.orderRepository.generateOrderNumber();
      const lastParts = lastOrderNumStr.split('-');
      nextOrderNumber = parseInt(lastParts[lastParts.length - 1]);

      // 3. Create Orders & Payments
      let parentOrderId: string | null = null;
      for (const orderDto of dto.orders) {
        const orderId = crypto.randomUUID();
        if (!parentOrderId) parentOrderId = orderId;

        let actualOrderNumber = orderDto.orderNumber;
        if (!actualOrderNumber) {
          actualOrderNumber = `${orderPrefix}${String(nextOrderNumber).padStart(3, '0')}`;
          nextOrderNumber++;
        }

        allOrders.push({
          id: orderId,
          receiptId,
          receiptNumber,
          clientId: dto.clientId,
          clientName,
          salesChannel: dto.salesChannel,
          type: orderDto.type,
          brandId: orderDto.brandId,
          total: Number(orderDto.total),
          status: orderDto.status || 'POR_RECIBIR',
          orderNumber: actualOrderNumber,
          parentOrderId: orderId === parentOrderId ? null : parentOrderId,
          createdAt: dto.createdAt || new Date(),
          transactionDate: dto.transactionDate,
          possibleDeliveryDate: orderDto.possibleDeliveryDate,
          paymentMethod: dto.paymentMethod,
          bankAccountId: dto.bankAccountId,
          notes: orderDto.notes,
          description: orderDto.description,
          trackingGuide: dto.trackingGuide,
          createdByName: createdBy,
          // Exchange-specific fields
          sourceOrderId: orderDto.sourceOrderId || null,
          sourceOrderNumber: orderDto.sourceOrderNumber || null,
          sourceBrandName: orderDto.sourceBrandName || null,
          sourceQuantity: orderDto.sourceQuantity ? Number(orderDto.sourceQuantity) : null,
          sourceDescription: orderDto.sourceDescription || null,
        });

        if (Number(orderDto.deposit || 0) > 0) {
          allPayments.push({
            id: crypto.randomUUID(),
            orderId,
            amount: Number(orderDto.deposit),
            method: dto.paymentMethod,
            receiptNumber: `AB-${crypto.randomUUID().slice(0, 6)}`,
            createdAt: new Date()
          });
        }
        
        if (orderDto.brandName) {
          orderBrandNames.set(orderId, orderDto.brandName);
        }
      }

      // Financial Logic
      const defaultBankId = (await tx.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } }))?.id;

      for (const payment of allPayments) {
        const order = allOrders.find(o => o.id === payment.orderId);
        const bName = orderBrandNames.get(payment.orderId) || (dto.orders.find(do_ => do_.brandId === order?.brandId)?.brandName) || '—';
        const orderSummary = { receiptNumber, orderNumber: order?.orderNumber, brandName: bName };
        const description = `Abono inicial | Marca: ${bName} | Orden: ${receiptNumber} | Pedido: ${order?.orderNumber || '—'}`;

        if (payment.method === 'BILLETERA_VIRTUAL') {
          // 1. Validate Balance
          if (!clientAccount) throw new Error(`No se encontró cuenta activa para el cliente ${clientName}`);
          await validateClientAccountCredit(currentWalletRunningBalance, -payment.amount, dto.clientId);
          
          if (!defaultBankId) throw new Error('No se encontró cuenta de caja activa para registrar el movimiento de billetera');

          // 2. Consume Individual Credits (FIFO)
          const availableCredits = await tx.clientCredit.findMany({
            where: { clientAccountId: clientAccount.id, status: 'AVAILABLE' },
            orderBy: { createdAt: 'asc' }
          });

          let remainingToSubtract = payment.amount;
          for (const credit of availableCredits) {
            if (remainingToSubtract <= 0) break;
            const amountToSubtract = Math.min(Number(credit.remainingAmount), remainingToSubtract);
            
            const newRemainingAmount = Number(credit.remainingAmount) - amountToSubtract;
            const newStatus = newRemainingAmount <= 0.01 ? 'USED' : 'AVAILABLE';

            await tx.clientCredit.update({
              where: { id: credit.id },
              data: {
                remainingAmount: { decrement: amountToSubtract },
                status: newStatus,
                usedAt: newStatus === 'USED' ? new Date() : undefined
              }
            });
            remainingToSubtract -= amountToSubtract;
          }

          if (remainingToSubtract > 0.01) {
            throw new Error(`Saldo a favor insuficiente para cubrir $${payment.amount.toFixed(2)} (error de concurrencia en créditos)`);
          }

          const balBefore = currentWalletRunningBalance;
          const balAfter = balBefore - payment.amount;
          currentWalletRunningBalance = balAfter;

          // 3. Update Total Balance
          await tx.clientAccount.update({
            where: { clientId: dto.clientId },
            data: { totalCreditAvailable: { decrement: payment.amount }, version: { increment: 1 } }
          });

          // 4. Record Financial Trace
          allFinancialRecords.push({
            id: crypto.randomUUID(),
            type: 'PAYMENT',
            source: 'WALLET',
            movementType: 'INTERNAL',
            fromAccountType: 'WALLET',
            toAccountType: 'INTERNAL',
            amount: payment.amount,
            date: new Date(),
            clientId: dto.clientId,
            clientName,
            clientDocument: clientDoc,
            bankAccountId: defaultBankId,
            referenceNumber: `WAL-USE-${crypto.randomUUID().slice(0, 12)}`,
            transactionGroupId,
            idempotencyKey: dto.idempotencyKey ? `${dto.idempotencyKey}-${payment.id}` : undefined,
            orderId: payment.orderId,
            orderPaymentId: payment.id,
            createdBy,
            notes: buildNotesJSON({
              title: 'USO_BILLETERA',
              module: 'ORDERS',
              clientDoc,
              orders: [orderSummary],
              description: description
            })
          });
        } else {
          // Cash/Bank Payment
          const bankId = payment.bankAccountId || dto.bankAccountId || defaultBankId;
          if (bankId) {
            if (!bankAccountBalances.has(bankId)) {
              const b = await tx.bankAccount.findUnique({ where: { id: bankId }, select: { currentBalance: true } });
              bankAccountBalances.set(bankId, Number(b?.currentBalance || 0));
            }

            const balBefore = bankAccountBalances.get(bankId)!;
            const balAfter = balBefore + payment.amount;
            bankAccountBalances.set(bankId, balAfter);
            
            allFinancialRecords.push({
              id: crypto.randomUUID(),
              type: 'PAYMENT',
              source: 'ORDER_PAYMENT',
              movementType: 'INCOME',
              fromAccountType: 'EXTERNAL',
              toAccountType: 'CASH',
              amount: payment.amount,
              date: new Date(),
              clientId: dto.clientId,
              clientName,
              clientDocument: clientDoc,
              bankAccountId: bankId,
              referenceNumber: `FIN-${crypto.randomUUID().slice(0, 12)}`,
              transactionGroupId,
              idempotencyKey: dto.idempotencyKey ? `${dto.idempotencyKey}-${payment.id}` : undefined,
              orderId: payment.orderId,
              orderPaymentId: payment.id,
              createdBy,
              notes: buildNotesJSON({
                title: cardTitleFromMethod(payment.method),
                module: 'ORDERS',
                clientDoc,
                orders: [orderSummary],
                description: description
              })
            });

            await tx.bankAccount.update({
              where: { id: bankId },
              data: { currentBalance: { increment: payment.amount }, version: { increment: 1 } }
            });
          }
        }
      }

      await tx.order.createMany({ data: allOrders });
      if (allPayments.length > 0) await tx.orderPayment.createMany({ data: allPayments });
      if (allFinancialRecords.length > 0) await tx.financialRecord.createMany({ data: allFinancialRecords });

      // Return orders with their payments for immediate PDF synchronization
      return allOrders.map(o => ({
        ...o,
        brandName: orderBrandNames.get(o.id) || '—',
        payments: allPayments.filter(p => p.orderId === o.id)
      }));
    });

    return Result.ok(resultOrders.map((o: any) => Order.create(o, o.id)));
  }
}
