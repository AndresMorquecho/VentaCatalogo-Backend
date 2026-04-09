import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import { PaymentValidationService, OrderAllocation, PaymentMethodAllocation } from '../domain/PaymentValidationService';
import { ProcessingRequest } from '../domain/ProcessingRequest.entity';
import { IProcessingRequestRepository } from '../domain/IProcessingRequestRepository';
import { validateBankAccountBalance } from '../../../shared/utils/financialValidations';
import { ConcurrencyError } from '../../../shared/errors/ConcurrencyError';
import { FinancialIntegrityError } from '../../../shared/errors/FinancialIntegrityError';
import { buildNotesJSON, cardTitleFromMethod } from '../../../shared/utils/transactionNotes';

export interface ProcessSplitPaymentDTO {
  orders: OrderAllocation[];
  payments: PaymentMethodAllocation[];
  total: number;
  requestId: string;
  clientId: string;
  createdBy: string;
}

export interface SplitPaymentResponse {
  success: boolean;
  receiptNumber?: string;
  orderPayments: Array<{
    orderId: string;
    paymentId: string;
    amount: number;
  }>;
  financialRecords: Array<{
    id: string;
    method: string;
    amount: number;
    bankAccountId: string;
  }>;
  error?: string;
}

export class ProcessSplitPaymentUseCase {
  constructor(
    private processingRequestRepository: IProcessingRequestRepository,
    private paymentValidationService: PaymentValidationService
  ) {}

  async execute(dto: ProcessSplitPaymentDTO): Promise<Result<SplitPaymentResponse>> {
    let processingRequest: ProcessingRequest | null = null;
    
    try {
      // ============================================================================
      // FASE 1: VERIFICACIÓN DE IDEMPOTENCIA
      // ============================================================================
      
      const idempotencyValidation = await this.paymentValidationService.validateIdempotency(dto.requestId);
      if (!idempotencyValidation.isValid) {
        if (idempotencyValidation.code === 'REQUEST_ALREADY_COMPLETED') {
          // Retornar resultado cached
          return Result.ok(idempotencyValidation.details.result);
        }
        return Result.fail(idempotencyValidation.error!);
      }

      // ============================================================================
      // FASE 2: CREAR PROCESSING REQUEST
      // ============================================================================
      
      try {
        processingRequest = ProcessingRequest.create(dto.requestId, dto);
        await this.processingRequestRepository.save(processingRequest);
      } catch (error: any) {
        if (error.code === '23505') { // Unique constraint violation
          return Result.fail('Request is being processed by another instance');
        }
        throw error;
      }

      // ============================================================================
      // FASE 3: VALIDACIONES PRE-TRANSACCIÓN
      // ============================================================================
      
      // 3.1 Validar totales
      const totalValidation = this.paymentValidationService.validatePaymentTotals(
        dto.orders, 
        dto.payments, 
        dto.total
      );
      if (!totalValidation.isValid) {
        await this.markRequestFailed(processingRequest, totalValidation.error!);
        return Result.fail(totalValidation.error!);
      }

      // 3.2 Validar montos positivos
      const allAmounts = [...dto.orders.map(o => o.amount), ...dto.payments.map(p => p.amount)];
      const positiveValidation = this.paymentValidationService.validatePositiveAmounts(allAmounts);
      if (!positiveValidation.isValid) {
        await this.markRequestFailed(processingRequest, positiveValidation.error!);
        return Result.fail(positiveValidation.error!);
      }

      // 3.3 Validar que órdenes existen
      const ordersValidation = await this.paymentValidationService.validateOrdersExist(dto.orders);
      if (!ordersValidation.success) {
        await this.markRequestFailed(processingRequest, ordersValidation.error!);
        return Result.fail(ordersValidation.error!);
      }

      // 3.4 Validar cuentas bancarias
      const bankValidation = await this.paymentValidationService.validateBankAccounts(dto.payments);
      if (!bankValidation.isValid) {
        await this.markRequestFailed(processingRequest, bankValidation.error!);
        return Result.fail(bankValidation.error!);
      }

      // 3.5 Validar saldo de billetera si es necesario
      const walletPayment = dto.payments.find(p => p.method === 'BILLETERA_VIRTUAL');
      if (walletPayment) {
        const walletValidation = await this.paymentValidationService.validateWalletBalance(
          dto.clientId, 
          walletPayment.amount
        );
        if (!walletValidation.isValid) {
          await this.markRequestFailed(processingRequest, walletValidation.error!);
          return Result.fail(walletValidation.error!);
        }
      }

      // ============================================================================
      // FASE 4: EJECUCIÓN TRANSACCIONAL ATÓMICA
      // ============================================================================
      
      const result = await prisma.$transaction(async (tx) => {
        const orderPayments: any[] = [];
        const financialRecords: any[] = [];
        let receiptNumber: string = '';

        // 4.1 CREAR OrderPayments (Business Logic) - UNO POR PEDIDO
        for (const orderAllocation of dto.orders) {
          const orderPayment = await tx.orderPayment.create({
            data: {
              orderId: orderAllocation.orderId,
              amount: orderAllocation.amount,
              method: 'SPLIT_PAYMENT',
              description: `Split payment - Request ${dto.requestId}`,
              receiptNumber: receiptNumber || this.generateReceiptNumber(),
              createdAt: new Date()
            }
          });
 
          if (!receiptNumber) {
            receiptNumber = orderPayment.receiptNumber!;
          }

          orderPayments.push({
            orderId: orderPayment.orderId,
            paymentId: orderPayment.id,
            amount: Number(orderPayment.amount)
          });
        }

        // 4.2 CREAR FinancialRecords (Accounting Logic) - UNO POR MÉTODO DE PAGO
        for (const paymentAllocation of dto.payments) {
          try {
            const bankAccountId = paymentAllocation.bankAccountId || 
              await this.paymentValidationService.getDefaultBankAccount(paymentAllocation.method);

            console.log(`[ProcessSplitPayment] Creating financial record for ${paymentAllocation.method}, bankAccountId: ${bankAccountId}`);

            // Capture balance snapshots before updates
            let balanceBefore: number | undefined;
            let balanceAfter: number | undefined;

            if (paymentAllocation.method === 'BILLETERA_VIRTUAL') {
              const clientAccount = await (tx as any).clientAccount.findUnique({
                where: { clientId: dto.clientId },
                select: { totalCreditAvailable: true }
              });
              if (clientAccount) {
                balanceBefore = parseFloat(clientAccount.totalCreditAvailable.toString());
                balanceAfter = balanceBefore - paymentAllocation.amount;
              }
              console.log(`[ProcessSplitPayment] Wallet balance: ${balanceBefore} → ${balanceAfter}`);
            } else {
              const bankAcc = await (tx as any).bankAccount.findUnique({
                where: { id: bankAccountId },
                select: { currentBalance: true }
              });
              if (bankAcc) {
                balanceBefore = parseFloat(bankAcc.currentBalance.toString());
                balanceAfter = balanceBefore + paymentAllocation.amount;
              }
            }

            const isCatalog = ordersValidation.data!.some((o: any) => o.type === 'CATALOGO');
            const cardTitle = isCatalog ? 'VENTA_CATALOGO' : cardTitleFromMethod(paymentAllocation.method);

            const notesJson = buildNotesJSON({
              title: cardTitle,
              module: 'ORDERS',
              clientDoc: ordersValidation.data![0].client?.identificationNumber ?? 'S/N',
              orders: ordersValidation.data!.map((o: any) => ({
                receiptNumber: o.receiptNumber,
                orderNumber: o.orderNumber ?? undefined,
                brandName: o.brandName || o.brand?.name || undefined
              })),
              description: paymentAllocation.notes || "",
              extra: `Abono inicial (Múltiple) - Request ${dto.requestId}`
            });

            const financialRecord = await (tx as any).financialRecord.create({
              data: {
                type: 'PAYMENT',
                source: 'ORDER_PAYMENT',
                movementType: paymentAllocation.method === 'BILLETERA_VIRTUAL' ? 'INTERNAL' : 'INCOME',
                fromAccountType: paymentAllocation.method === 'BILLETERA_VIRTUAL' ? 'WALLET' : 'EXTERNAL',
                toAccountType: paymentAllocation.method === 'BILLETERA_VIRTUAL' ? 'ORDER' : 'CASH',
                referenceNumber: await this.generateReferenceNumber(paymentAllocation.method),
                userReference: receiptNumber,
                amount: paymentAllocation.amount,
                date: new Date(),
                clientId: dto.clientId,
                clientName: ordersValidation.data![0].clientName,
                clientDocument: ordersValidation.data![0].client?.identificationNumber ?? null,
                orderId: dto.orders.length === 1 ? dto.orders[0].orderId : null,
                notes: notesJson,
                createdBy: dto.createdBy,
                bankAccountId,
                paymentMethod: paymentAllocation.method,
                balanceBefore: balanceBefore ?? null,
                balanceAfter: balanceAfter ?? null,
                createdAt: new Date(),
                version: 1
              }
            });

            console.log(`[ProcessSplitPayment] Financial record created: ${financialRecord.id}`);

            financialRecords.push({
              id: financialRecord.id,
              method: financialRecord.paymentMethod!,
              amount: Number(financialRecord.amount),
              bankAccountId: financialRecord.bankAccountId
            });
          } catch (error) {
            console.error(`[ProcessSplitPayment] ERROR creating financial record for ${paymentAllocation.method}:`, error);
            throw error;
          }
        }

        // 4.3 ACTUALIZAR BankAccount Balances (Solo métodos no-wallet)
        for (const paymentAllocation of dto.payments) {
          if (paymentAllocation.method !== 'BILLETERA_VIRTUAL') {
            await this.updateBankAccountBalance(
              tx,
              paymentAllocation.bankAccountId!,
              paymentAllocation.amount
            );
          }
        }

        // 4.4 PROCESAR Wallet Payment (Si existe)
        if (walletPayment) {
          await this.processWalletPayment(tx, dto.clientId, walletPayment.amount);
        }

        return {
          orderPayments,
          financialRecords,
          receiptNumber
        };
      });

      // ============================================================================
      // FASE 5: FINALIZACIÓN
      // ============================================================================
      
      const response: SplitPaymentResponse = {
        success: true,
        receiptNumber: result.receiptNumber,
        orderPayments: result.orderPayments,
        financialRecords: result.financialRecords
      };

      await this.markRequestCompleted(processingRequest, response);
      return Result.ok(response);

    } catch (error: any) {
      console.error('ProcessSplitPaymentUseCase Error:', error);
      
      if (processingRequest) {
        await this.markRequestFailed(processingRequest, error.message);
      }
      
      return Result.fail(error instanceof Error ? error.message : 'Failed to process split payment');
    }
  }

  // ============================================================================
  // MÉTODOS AUXILIARES CRÍTICOS
  // ============================================================================

  private async processWalletPayment(tx: any, clientId: string, amount: number): Promise<void> {
    // Obtener créditos disponibles ordenados por fecha (FIFO)
    const availableCredits = await tx.clientCredit.findMany({
      where: {
        clientAccount: { clientId },
        status: 'AVAILABLE'
      },
      select: {
        id: true,
        remainingAmount: true,
        version: true
      },
      orderBy: { createdAt: 'asc' }  // FIFO
    });

    let remainingToDeduct = amount;
    
    // Procesar créditos en orden FIFO
    for (const credit of availableCredits) {
      if (remainingToDeduct <= 0) break;
      
      const deductionAmount = Math.min(Number(credit.remainingAmount), remainingToDeduct);
      const newRemainingAmount = Number(credit.remainingAmount) - deductionAmount;
      const newStatus = newRemainingAmount <= 0.01 ? 'USED' : 'AVAILABLE';

      // OPTIMISTIC LOCKING: Actualizar crédito
      const updateResult = await tx.clientCredit.updateMany({
        where: {
          id: credit.id,
          version: credit.version
        },
        data: {
          remainingAmount: { decrement: deductionAmount },
          status: newStatus,
          usedAt: newStatus === 'USED' ? new Date() : undefined,
          version: { increment: 1 }
        }
      });

      if (updateResult.count === 0) {
        throw new ConcurrencyError(
          'Client credit was modified by another transaction',
          'ClientCredit',
          credit.id
        );
      }

      remainingToDeduct -= deductionAmount;
    }

    // VALIDACIÓN CRÍTICA: Verificar que se cubrió todo el monto
    if (remainingToDeduct > 0.01) {
      throw new FinancialIntegrityError(
        `Insufficient wallet balance. Missing: ${remainingToDeduct.toFixed(2)}`,
        'OTHER'
      );
    }

    // ACTUALIZAR ClientAccount.totalCreditAvailable
    await this.updateClientAccountCredit(tx, clientId, amount);
  }

  private async updateBankAccountBalance(tx: any, bankAccountId: string, amount: number): Promise<void> {
    const bankAccount = await tx.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: { id: true, currentBalance: true, version: true, name: true }
    });

    if (!bankAccount) {
      throw new FinancialIntegrityError(
        `Bank account ${bankAccountId} not found`,
        'INVALID_STATE'
      );
    }

    // VALIDACIÓN FINANCIERA
    validateBankAccountBalance(
      Number(bankAccount.currentBalance),
      amount,
      bankAccountId,
      bankAccount.name
    );

    // OPTIMISTIC LOCKING: Actualizar con versión
    const updateResult = await tx.bankAccount.updateMany({
      where: {
        id: bankAccountId,
        version: bankAccount.version
      },
      data: {
        currentBalance: { increment: amount },
        updatedAt: new Date(),
        version: { increment: 1 }
      }
    });

    if (updateResult.count === 0) {
      throw new ConcurrencyError(
        'Bank account was modified by another transaction',
        'BankAccount',
        bankAccountId
      );
    }
  }

  private async updateClientAccountCredit(tx: any, clientId: string, amount: number): Promise<void> {
    const clientAccount = await tx.clientAccount.findUnique({
      where: { clientId },
      select: { id: true, totalCreditAvailable: true, version: true }
    });

    if (!clientAccount) {
      throw new FinancialIntegrityError(
        `Client account for client ${clientId} not found`,
        'INVALID_STATE'
      );
    }

    // OPTIMISTIC LOCKING: Actualizar con versión
    const updateResult = await tx.clientAccount.updateMany({
      where: {
        id: clientAccount.id,
        version: clientAccount.version
      },
      data: {
        totalCreditAvailable: { decrement: amount },
        version: { increment: 1 }
      }
    });

    if (updateResult.count === 0) {
      throw new ConcurrencyError(
        'Client account was modified by another transaction',
        'ClientAccount',
        clientAccount.id
      );
    }
  }

  private async markRequestCompleted(request: ProcessingRequest, result: SplitPaymentResponse): Promise<void> {
    request.markCompleted(result);
    await this.processingRequestRepository.update(request);
  }

  private async markRequestFailed(request: ProcessingRequest, error: string): Promise<void> {
    request.markFailed(error);
    await this.processingRequestRepository.update(request);
  }

  private generateReceiptNumber(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.getTime().toString().slice(-6);
    return `SPL-${dateStr}-${timeStr}`;
  }

  private async generateReferenceNumber(method: string): Promise<string> {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.getTime().toString().slice(-8);
    const methodPrefix = method.substring(0, 3).toUpperCase();
    return `${methodPrefix}-${dateStr}-${timeStr}`;
  }
}