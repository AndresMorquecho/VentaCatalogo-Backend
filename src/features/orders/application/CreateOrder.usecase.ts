import { IOrderRepository } from '../domain/IOrderRepository';
import { Order, OrderStatus } from '../domain/Order.entity';
import { Result } from '../../../shared/domain/Result';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { IBankAccountRepository } from '../../financial/domain/IBankAccountRepository';
import { FinancialRecord } from '../../financial/domain/FinancialRecord.entity';
import { prisma } from '../../../lib/prisma';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { validateBankAccountBalance, validateClientCreditBalance } from '../../../shared/utils/financialValidations';

export interface CreateOrderDTO {
  receiptNumber?: string; // Optional manual receipt number
  salesChannel: string;
  type: string;
  brandId: string;
  brandName: string;
  total: number;
  paymentMethod: string;
  bankAccountId?: string;
  transactionDate: Date;
  possibleDeliveryDate: Date;
  clientId: string;
  clientName: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    brandId: string;
    brandName: string;
    link?: string;
  }>;
  notes?: string;
  createdByName?: string; // Username del que crea el pedido
  createdAt?: Date; // Optional manual registration date
  initialPayment: {
    amount: number;
    method: string;
    reference?: string;
  };
  payments?: Array<{
    amount: number;
    method: string;
    bankAccountId?: string;
    reference?: string;
    notes?: string;
  }>;
  creditAmount?: number;
  parentOrderId?: string;
  orderNumber?: string;
  status?: string;
  // Structured exchange fields
  sourceOrderId?: string;
  sourceOrderNumber?: string;
  sourceBrandName?: string;
  sourceQuantity?: number;
  sourceDescription?: string;
  description?: string;
}


export class CreateOrderUseCase {
  constructor(
    private orderRepository: IOrderRepository,
    private financialRepository: IFinancialRecordRepository,
    private bankAccountRepository: IBankAccountRepository
  ) { }

  async execute(dto: CreateOrderDTO, createdBy: string): Promise<Result<Order>> {
    try {
      // Validate required fields
      if (!dto.clientId || !dto.brandId) {
        return Result.fail('Client ID and Brand ID are required');
      }

      // Pre-fetch all necessary checks in parallel to reduce sequential round-trips
      const [brand, client, lastClosure, generatedReceiptNumber] = await Promise.all([
        prisma.brand.findUnique({ where: { id: dto.brandId } }),
        prisma.client.findUnique({ where: { id: dto.clientId } }),
        prisma.cashClosure.findFirst({ orderBy: { toDate: 'desc' } }),
        dto.receiptNumber ? Promise.resolve(dto.receiptNumber) : this.orderRepository.generateReceiptNumber()
      ]);

      if (!brand || !brand.isActive) {
        return Result.fail(`La marca ${brand?.name || ''} no está activa y no puede recibir pedidos.`);
      }

      if (!client) {
        return Result.fail('Cliente no encontrado');
      }

      if (client.isBlocked) {
        return Result.fail('La empresaria está bloqueada y no puede realizar nuevos pedidos.');
      }


      if (!dto.initialPayment || dto.initialPayment.amount === undefined) {
        return Result.fail('Initial payment information is required');
      }

      if (lastClosure && new Date(dto.transactionDate) <= lastClosure.toDate) {
        return Result.fail('No se puede crear un pedido con fecha de transacción en un periodo de caja ya cerrado.');
      }

      const receiptNumber = generatedReceiptNumber;

      // 4. Transform items with defensive checks
      const itemsItems = dto.items.map(item => ({
        id: crypto.randomUUID(),
        productName: item.productName || item.brandName || 'Producto',
        brandName: item.brandName || item.productName || 'Marca',
        quantity: Number(item.quantity || 1),
        unitPrice: Number(item.unitPrice || 0),
        brandId: item.brandId
      }));

      // Execute everything in a transaction for atomicity
      const orderReceiptNumber = receiptNumber || await this.orderRepository.generateReceiptNumber();
      const actualOrderNumber = dto.orderNumber || await this.orderRepository.generateOrderNumber();
      const clientDoc = client?.identificationNumber || 'S/N';

      const savedOrder = await prisma.$transaction(async (tx) => {
        // Find or create Order Receipt Group
        let receiptId: string;
        const existingReceipt = await (tx as any).orderReceipt.findUnique({
          where: { receiptNumber: orderReceiptNumber }
        });

        if (existingReceipt) {
          receiptId = existingReceipt.id;
        } else {
          receiptId = crypto.randomUUID();
          await (tx as any).orderReceipt.create({
            data: {
              id: receiptId,
              receiptNumber: orderReceiptNumber,
              clientId: dto.clientId,
              clientName: dto.clientName,
              salesChannel: dto.salesChannel,
              createdAt: dto.createdAt ? new Date(dto.createdAt) : new Date(),
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

        // Get numbering for payment receipts
        const lastPayment = await (tx.orderPayment as any).findFirst({
          where: { receiptNumber: { startsWith: 'REC-ABO-' } },
          orderBy: { createdAt: 'desc' }
        });

        let nextPaymentNumber = 1;
        if (lastPayment && (lastPayment as any).receiptNumber) {
          const match = (lastPayment as any).receiptNumber.match(/(\d+)$/);
          if (match) nextPaymentNumber = parseInt(match[1]) + 1;
        }

        // 1. Determine Payments to process
        const sources = (dto.payments && dto.payments.length > 0)
          ? dto.payments 
          : (dto.initialPayment && dto.initialPayment.amount > 0 ? [dto.initialPayment] : []);

        const paymentsToCreate = [];
        const financialRecordsPending: any[] = [];
        let totalCreditUsed = 0;
        const accountBalancesMap = new Map<string, number>();
        let clientWalletRunningBal: number | null = null;

        // 2. Sequential processing of financial movements
        for (const p of sources) {
          const pAmount = Number(p.amount);
          if (pAmount <= 0) continue;

          const pReceiptNumber = `REC-ABO-${(nextPaymentNumber++).toString().padStart(6, '0')}`;
          const isWallet = p.method === 'BILLETERA_VIRTUAL' || p.method === 'CREDITO_CLIENTE' || p.method === 'SALDO_A_FAVOR';
          
          paymentsToCreate.push({
            amount: pAmount,
            method: p.method,
            reference: p.reference,
            receiptNumber: pReceiptNumber,
            description: (p as any).notes || (dto.type === 'CATALOGO' ? 'Venta de catálogo' : 'Abono inicial')
          });

          if (isWallet) {
            totalCreditUsed += pAmount;
            
            if (clientWalletRunningBal === null) {
              const clientAcc = await tx.clientAccount.findUnique({
                where: { clientId: dto.clientId },
                select: { totalCreditAvailable: true }
              });
              clientWalletRunningBal = Number(clientAcc?.totalCreditAvailable || 0);
            }

            const balanceBefore: number = clientWalletRunningBal!;
            const balanceAfter: number = balanceBefore - pAmount;
            clientWalletRunningBal = balanceAfter;
            
            // Buscar el crédito más antiguo (FIFO) y obtener el bankAccountId de su FinancialRecord de origen
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
              const originFR = await tx.financialRecord.findUnique({
                where: { id: oldestCredit.originTransactionId },
                select: { bankAccountId: true }
              });
              if (originFR?.bankAccountId) walletBankId = originFR.bankAccountId;
            }
            
            if (!walletBankId) {
              const cashAccount = await tx.bankAccount.findFirst({
                where: { type: 'CASH', isActive: true },
                select: { id: true }
              });
              if (cashAccount) walletBankId = cashAccount.id;
            }

            if (!walletBankId) {
               throw new Error('No se pudo determinar una cuenta bancaria para el movimiento de billetera virtual');
            }

            financialRecordsPending.push({
              type: 'PAYMENT',
              source: 'ORDER_PAYMENT',
              movementType: 'INTERNAL',
              fromAccountType: 'WALLET',
              toAccountType: 'ORDER',
              amount: pAmount,
              date: new Date(),
              clientId: dto.clientId,
              clientName: dto.clientName,
              createdBy,
              notes: JSON.stringify({
                v: 2,
                title: dto.type === 'CATALOGO' ? 'VENTA_CATALOGO' : 'ABONO',
                module: 'ORDER',
                description: ((p as any).notes ? (p as any).notes : `Pedido inicial`),
                orders: [{ receiptNumber: orderReceiptNumber, orderNumber: actualOrderNumber, brandName: dto.brandName, type: dto.type }]
              }),
              userReference: pReceiptNumber,
              bankAccountId: walletBankId,
              paymentMethod: p.method,
              clientDocument: clientDoc,
              balanceBefore,
              balanceAfter,
              version: 1
            });
          } else {
            const pBankId = (p as any).bankAccountId || dto.bankAccountId;
            if (!pBankId) {
              throw new Error(`Bank account is required for payment method ${p.method}`);
            }

            // Initialize bank balance in map if not present
            if (!accountBalancesMap.has(pBankId)) {
              const acc = await tx.bankAccount.findUnique({
                where: { id: pBankId },
                select: { currentBalance: true }
              });
              accountBalancesMap.set(pBankId, Number(acc?.currentBalance || 0));
            }
            const balanceBefore: number = accountBalancesMap.get(pBankId)!;
            const balanceAfter: number = balanceBefore + pAmount;
            
            // Update MAP for next iteration
            accountBalancesMap.set(pBankId, balanceAfter);

            // Update DB (Sequential increment)
            await tx.bankAccount.update({
              where: { id: pBankId },
              data: { 
                currentBalance: { increment: pAmount },
                version: { increment: 1 },
                updatedAt: new Date()
              }
            });

            financialRecordsPending.push({
              type: 'PAYMENT',
              source: 'ORDER_PAYMENT',
              movementType: 'INCOME',
              fromAccountType: 'EXTERNAL',
              toAccountType: 'CASH',
              amount: pAmount,
              date: new Date(),
              clientId: dto.clientId,
              clientName: dto.clientName,
              clientDocument: clientDoc,
              createdBy,
              notes: JSON.stringify({
                v: 2,
                title: dto.type === 'CATALOGO' ? 'VENTA_CATALOGO' : 'ABONO',
                module: 'ORDER',
                description: ((p as any).notes ? (p as any).notes : `Pedido inicial`),
                orders: [{ receiptNumber: orderReceiptNumber, orderNumber: actualOrderNumber, brandName: dto.brandName, type: dto.type }]
              }),
              userReference: pReceiptNumber,
              bankAccountId: pBankId,
              paymentMethod: p.method,
              balanceBefore,
              balanceAfter,
              version: 1,
              createdAt: new Date()
            });
          }
        }

        // ============================================================================
        // 3. Persist everything and Commit (Batch creations inside transaction)
        // ============================================================================
        
        // Final total logic for the created order
        const totalPaid = sources.reduce((sum, p) => sum + Number(p.amount), 0);
        
        // 3. Handle additional credit (if provided via separate field)
        const extraCredit = Number(dto.creditAmount || 0);
        if (extraCredit > totalCreditUsed) {
           const diff = extraCredit - totalCreditUsed;
           totalCreditUsed = extraCredit;
           const pReceiptNumber = `REC-ABO-${(nextPaymentNumber++).toString().padStart(6, '0')}`;
           paymentsToCreate.push({
             amount: diff,
             method: 'CREDITO_CLIENTE',
             receiptNumber: pReceiptNumber,
             description: 'Saldo a favor aplicado'
           });
        }

        // 4. Update Client Account and Credits in DB
        if (totalCreditUsed > 0.01) {
          const clientAccount = await tx.clientAccount.findUnique({
            where: { clientId: dto.clientId },
            select: { id: true, totalCreditAvailable: true, version: true }
          });
          if (!clientAccount) throw new Error(`Client account not found for ${dto.clientId}`);

          await tx.clientAccount.update({
             where: { id: clientAccount.id },
             data: { 
               totalCreditAvailable: { decrement: totalCreditUsed },
               version: { increment: 1 }
             }
          });

          const availableCredits = await tx.clientCredit.findMany({
            where: { clientAccountId: clientAccount.id, status: 'AVAILABLE' },
            orderBy: { createdAt: 'asc' }
          });

          let rem = totalCreditUsed;
          for (const credit of availableCredits) {
            if (rem <= 0.01) break;
            const sub = Math.min(Number(credit.remainingAmount), rem);
            await tx.clientCredit.update({
              where: { id: credit.id },
              data: { 
                remainingAmount: { decrement: sub },
                status: Number(credit.remainingAmount) - sub <= 0.01 ? 'USED' : 'AVAILABLE',
                version: { increment: 1 }
              }
            });
            rem -= sub;
          }
        }

        // 5. Create the Order
        const createdOrder = await tx.order.create({
          data: {
            id: crypto.randomUUID(),
            receiptNumber: orderReceiptNumber,
            receiptId,
            salesChannel: dto.salesChannel,
            type: dto.type,
            brandId: dto.brandId,
            total: Number(dto.total),
            paymentMethod: dto.paymentMethod,
            bankAccountId: dto.bankAccountId || null,
            transactionDate: dto.transactionDate,
            possibleDeliveryDate: dto.possibleDeliveryDate,
            status: (dto.status as OrderStatus) || OrderStatus.POR_RECIBIR,
            parentOrderId: dto.parentOrderId || null,
            orderNumber: actualOrderNumber,
            clientId: dto.clientId,
            clientName: dto.clientName,
            notes: dto.notes || null,
            createdByName: dto.createdByName || createdBy || null,
            createdAt: dto.createdAt ? new Date(dto.createdAt) : new Date(),
            sourceOrderId: dto.sourceOrderId,
            sourceOrderNumber: dto.sourceOrderNumber,
            sourceBrandName: dto.sourceBrandName,
            sourceQuantity: dto.sourceQuantity,
            sourceDescription: dto.sourceDescription,
            description: dto.description,
            version: 1,
            items: { create: itemsItems.map(i => ({
                id: i.id,
                productName: i.productName,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                brandId: i.brandId,
                brandName: i.brandName
            })) },
            payments: {
              create: paymentsToCreate.map(p => ({
                amount: p.amount,
                method: p.method,
                reference: p.reference || null,
                receiptNumber: p.receiptNumber,
                description: p.description
              }))
            }
          } as any,
          include: {
            items: true,
            payments: true,
            brand: true
          }
        });

        // 6. Create Financial Records linked to Payments
        const finalOps = [];
        for (const fr of financialRecordsPending) {
           const match = createdOrder.payments.find(p => p.receiptNumber === fr.userReference);
           finalOps.push(tx.financialRecord.create({
              data: {
                ...fr,
                clientId: dto.clientId,
                clientName: dto.clientName,
                createdBy,
                orderId: createdOrder.id,
                orderPaymentId: match?.id || null,
                referenceNumber: fr.referenceNumber || `REF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
              }
           }));
        }

        // 7. Update client last order info
        await tx.client.update({
          where: { id: dto.clientId },
          data: {
            lastOrderDate: new Date(),
            lastBrandName: dto.brandName
          }
        });

        await Promise.all(finalOps);
        return createdOrder;
      }, {
        timeout: 30000,
        maxWait: 10000
      });

      // Map back to Domain Entity
      const finalOrder = Order.create({
        receiptNumber: savedOrder.receiptNumber,
        salesChannel: savedOrder.salesChannel,
        type: savedOrder.type,
        brandId: savedOrder.brandId,
        brandName: (savedOrder as any).brandName || dto.brandName || '—',
        total: Number(savedOrder.total),
        realInvoiceTotal: savedOrder.realInvoiceTotal ? Number(savedOrder.realInvoiceTotal) : undefined,
        paymentMethod: savedOrder.paymentMethod,
        bankAccountId: savedOrder.bankAccountId || undefined,
        transactionDate: savedOrder.transactionDate,
        possibleDeliveryDate: savedOrder.possibleDeliveryDate,
        status: savedOrder.status as any,
        parentOrderId: savedOrder.parentOrderId || undefined,
        orderNumber: (savedOrder as any).orderNumber || undefined,
        clientId: savedOrder.clientId,
        clientName: savedOrder.clientName,
        notes: savedOrder.notes || undefined,
        sourceOrderId: (savedOrder as any).sourceOrderId || undefined,
        sourceOrderNumber: (savedOrder as any).sourceOrderNumber || undefined,
        sourceBrandName: (savedOrder as any).sourceBrandName || undefined,
        sourceQuantity: (savedOrder as any).sourceQuantity || undefined,
        sourceDescription: (savedOrder as any).sourceDescription || undefined,
        description: (savedOrder as any).description || undefined,
        items: savedOrder.items.map((i: any) => ({
          id: i.id,
          productName: i.productName,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          brandId: i.brandId,
          brandName: i.brandName
        })),
        payments: savedOrder.payments.map((p: any) => ({
          id: p.id,
          amount: Number(p.amount),
          method: p.method,
          reference: p.reference || undefined,
          receiptNumber: (p as any).receiptNumber || undefined,
          description: p.description || undefined,
          createdAt: p.createdAt
        })),
        createdAt: savedOrder.createdAt,
        updatedAt: savedOrder.updatedAt,
        version: savedOrder.version
      }, savedOrder.id);

      return Result.ok(finalOrder);
    } catch (error) {
      console.error('CreateOrderUseCase Error:', error);
      return Result.fail(error instanceof Error ? error.message : 'Failed to create order');
    }
  }
}
