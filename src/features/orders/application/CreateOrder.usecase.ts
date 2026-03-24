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

      // Create order items with IDs
      const items = dto.items.map(item => ({
        id: crypto.randomUUID(),
        ...item
      }));

      // Create order entity
      const order = Order.create(
        {
          receiptNumber,
          salesChannel: dto.salesChannel,
          type: dto.type,
          brandId: dto.brandId,
          brandName: dto.brandName,
          total: dto.total,
          paymentMethod: dto.paymentMethod,
          bankAccountId: dto.bankAccountId,
          transactionDate: dto.transactionDate,
          possibleDeliveryDate: dto.possibleDeliveryDate,
          status: OrderStatus.POR_RECIBIR,
          clientId: dto.clientId,
          clientName: dto.clientName,
          notes: dto.notes,
          items,
          payments: [],
          parentOrderId: dto.parentOrderId,
          orderNumber: dto.orderNumber,
          createdAt: dto.createdAt ? new Date(dto.createdAt) : new Date(),
          updatedAt: new Date(),
          version: 1
        },
        crypto.randomUUID()
      );


      // Execute everything in a transaction for atomicity
      const orderReceiptNumber = receiptNumber || await this.orderRepository.generateReceiptNumber();
      const actualOrderNumber = dto.orderNumber || await this.orderRepository.generateOrderNumber();
      const clientDoc = client?.identificationNumber || 'S/N';

      const savedOrder = await prisma.$transaction(async (tx) => {
        // ✅ CORRECCIÓN: Verificar si OrderReceipt ya existe antes de crear
        let receiptId: string;
        const existingReceipt = await (tx as any).orderReceipt.findUnique({
          where: { receiptNumber }
        });

        if (existingReceipt) {
          // Recibo ya existe, usar su ID
          receiptId = existingReceipt.id;
        } else {
          // Recibo nuevo, crear
          receiptId = crypto.randomUUID();
          await (tx as any).orderReceipt.create({
            data: {
              id: receiptId,
              receiptNumber,
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

        // 1. Get base receipt number for payments once inside the transaction
        const lastPayment = await (tx.orderPayment as any).findFirst({
          where: { receiptNumber: { startsWith: 'REC-ABO-' } },
          orderBy: { createdAt: 'desc' }
        });

        let nextPaymentNumber = 1;
        if (lastPayment && (lastPayment as any).receiptNumber) {
          const match = (lastPayment as any).receiptNumber.match(/(\d+)$/);
          if (match) nextPaymentNumber = parseInt(match[1]) + 1;
        }

        const paymentsToCreate = [];
        const financialRecordsToCreate = [];
        const bankAccountIncrements = new Map<string, number>();

        // 2. Determine Payments to process (Multi-payment vs Simple)
        const sources = (dto.payments && dto.payments.length > 0)
          ? dto.payments 
          : (dto.initialPayment.amount > 0 ? [dto.initialPayment] : []);

        for (const p of sources) {
          const pAmount = Number(p.amount);
          if (pAmount <= 0) continue;

          const pReceiptNumber = `REC-ABO-${(nextPaymentNumber++).toString().padStart(6, '0')}`;
          const isWallet = p.method === 'BILLETERA_VIRTUAL' || p.method === 'CREDITO_CLIENTE';
          const pBankId = (p as any).bankAccountId || dto.bankAccountId;

          paymentsToCreate.push({
            amount: pAmount,
            method: p.method,
            reference: p.reference,
            receiptNumber: pReceiptNumber,
            description: (p as any).notes || (dto.type === 'CATALOGO' ? 'Venta de catálogo' : 'Abono inicial')
          });

          if (!isWallet) {
            if (!pBankId) {
              throw new Error(`Bank account is required for payment method ${p.method}`);
            }

            financialRecordsToCreate.push({
              type: 'PAYMENT',
              source: 'ORDER_PAYMENT',
              movementType: 'INCOME',
              referenceNumber: p.method !== 'EFECTIVO' && p.reference
                ? p.reference
                : `REF-INI-${Date.now()}-${Math.random().toString(36).substring(7)}`,
              amount: pAmount,
              date: new Date(),
              clientId: dto.clientId,
              clientName: dto.clientName,
              createdBy,
              notes: ((p as any).notes ? ((p as any).notes + ' | ') : `Pedido inicial | `) + `Cédula: ${clientDoc} | Orden: ${orderReceiptNumber} | Pedido: ${actualOrderNumber} | Marca: ${dto.brandName} | Tipo: ${dto.type.toUpperCase()}`,
              userReference: pReceiptNumber,
              bankAccountId: pBankId,
              paymentMethod: p.method,
              version: 1
            });

            const current = bankAccountIncrements.get(pBankId) || 0;
            bankAccountIncrements.set(pBankId, current + pAmount);
          }
        }

        // 3. Prepare Credit Usage data (legacy field compatibility)
        let totalCreditToUse = dto.creditAmount || 0;
        // Also if any payment was 'CREDITO_CLIENTE', add to totalCreditToUse if not already part of it
        const directWalletAmount = (dto.payments || [])
          .filter(p => p.method === 'BILLETERA_VIRTUAL' || p.method === 'CREDITO_CLIENTE')
          .reduce((sum, p) => sum + Number(p.amount), 0);
        
        if (directWalletAmount > totalCreditToUse) {
          totalCreditToUse = directWalletAmount;
        }

        if (totalCreditToUse > 0) {
          // If NOT already added to paymentsToCreate above, add it
          const alreadyAddedWallet = paymentsToCreate.some(p => p.method === 'CREDITO_CLIENTE' || p.method === 'BILLETERA_VIRTUAL');
          if (!alreadyAddedWallet) {
              const creditPaymentReceiptNumber = `REC-ABO-${(nextPaymentNumber++).toString().padStart(6, '0')}`;
              paymentsToCreate.push({
                amount: totalCreditToUse,
                method: 'CREDITO_CLIENTE',
                receiptNumber: creditPaymentReceiptNumber,
                description: 'Saldo a favor aplicado'
              });
          }
        }

        // 4. Create order with items and payments in ONE call
        const rawOrder = order.toJSON();
        const createdOrder = await tx.order.create({
          data: {
            id: rawOrder.id,
            receiptNumber: rawOrder.receiptNumber,
            receiptId,
            salesChannel: rawOrder.salesChannel,
            type: rawOrder.type,
            brandId: rawOrder.brandId,
            total: rawOrder.total,
            paymentMethod: rawOrder.paymentMethod,
            bankAccountId: rawOrder.bankAccountId,
            transactionDate: rawOrder.transactionDate,
            possibleDeliveryDate: rawOrder.possibleDeliveryDate,
            status: rawOrder.status as any,
            parentOrderId: rawOrder.parentOrderId,
            orderNumber: (rawOrder as any).orderNumber,
            clientId: rawOrder.clientId,
            clientName: rawOrder.clientName,
            notes: rawOrder.notes,
            createdByName: dto.createdByName || createdBy || null,
            createdAt: rawOrder.createdAt,
            version: rawOrder.version,
            items: { create: order.items },
            payments: paymentsToCreate.length > 0 ? { create: paymentsToCreate } : undefined
          } as any,
          include: {
            items: true,
            payments: true,
            brand: true
          }
        });

        // 5. Handle Financial Records and Bank Account update in parallel
        const financialAndBankOps = [];
        
        // Add order link to financial records and add to ops
        for (const frData of financialRecordsToCreate) {
          financialAndBankOps.push(tx.financialRecord.create({
            data: { ...frData, orderId: createdOrder.id }
          }));
        }

        // Bank account balance update with optimistic locking (Loop over all affected accounts)
        for (const [accountId, increment] of bankAccountIncrements.entries()) {
          // Read account with version
          const bankAccount = await tx.bankAccount.findUnique({
            where: { id: accountId },
            select: { id: true, currentBalance: true, version: true, name: true }
          });

          if (!bankAccount) {
            throw new Error(`Bank account ${accountId} not found`);
          }

          // Validate financial integrity
          validateBankAccountBalance(
            Number(bankAccount.currentBalance),
            increment,
            accountId,
            bankAccount.name
          );

          // Update with optimistic locking
          financialAndBankOps.push((async () => {
            const result = await tx.bankAccount.updateMany({
              where: {
                id: accountId,
                version: bankAccount.version
              },
              data: {
                currentBalance: { increment: increment },
                updatedAt: new Date(),
                version: { increment: 1 }
              }
            });

            if (result.count === 0) {
              throw new ConcurrencyError(
                'Bank account was modified by another transaction. Please retry.',
                'BankAccount',
                accountId
              );
            }
          })());
        }

        // 6. Handle Wallet/Credit Reversion if applicable
        if (totalCreditToUse > 0.01) {
          const availableCredits = await tx.clientCredit.findMany({
            where: {
              clientAccount: { clientId: dto.clientId },
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

          let remToSub = totalCreditToUse;
          for (const credit of availableCredits) {
            if (remToSub <= 0.01) break;
            const amountToSubtract = Math.min(Number(credit.remainingAmount), remToSub);

            // Validate financial integrity
            validateClientCreditBalance(
              Number(credit.remainingAmount),
              amountToSubtract,
              credit.id
            );

            const newRemainingAmount = Number(credit.remainingAmount) - amountToSubtract;
            const newStatus = newRemainingAmount <= 0.01 ? 'USED' : 'AVAILABLE';

            // Update with optimistic locking
            financialAndBankOps.push((async () => {
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
            })());

            remToSub -= amountToSubtract;
          }

          if (remToSub > 0.01) {
            throw new Error(`Saldo a favor insuficiente para cubrir $${totalCreditToUse.toFixed(2)}`);
          }
        }

        // 7. Update client last order info
        financialAndBankOps.push(tx.client.update({
          where: { id: dto.clientId },
          data: {
            lastOrderDate: new Date(),
            lastBrandName: dto.brandName
          }
        }));

        await Promise.all(financialAndBankOps);

        return createdOrder;
      });

      if (!savedOrder) throw new Error("Failed to retrieve saved order");

      // Map back to Domain Entity
      const finalOrder = Order.create({
        receiptNumber: savedOrder.receiptNumber,
        salesChannel: savedOrder.salesChannel,
        type: savedOrder.type,
        brandId: savedOrder.brandId,
        brandName: (savedOrder as any).brand?.name || 'Sin marca',
        total: Number(savedOrder.total),
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
