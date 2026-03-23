import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProcessSplitPaymentUseCase,
  ProcessSplitPaymentDTO,
  SplitPaymentResponse,
} from '../ProcessSplitPayment.usecase';
import { PaymentValidationService } from '../../domain/PaymentValidationService';
import { IProcessingRequestRepository } from '../../domain/IProcessingRequestRepository';
import { ProcessingRequest } from '../../domain/ProcessingRequest.entity';

// ============================================================================
// TEST HELPERS
// ============================================================================

function makeRequestId(): string {
  return `split-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeValidationServiceMock(): PaymentValidationService {
  return {
    validatePaymentTotals: vi.fn().mockReturnValue({ isValid: true }),
    validatePositiveAmounts: vi.fn().mockReturnValue({ isValid: true }),
    validateOrdersExist: vi.fn().mockResolvedValue({
      success: true,
      data: [
        { id: 'order-001', clientId: 'client-001', clientName: 'Test Client', status: 'PENDING', total: 100 },
        { id: 'order-002', clientId: 'client-001', clientName: 'Test Client', status: 'PENDING', total: 150 },
      ],
    }),
    validateBankAccounts: vi.fn().mockResolvedValue({ isValid: true }),
    validateWalletBalance: vi.fn().mockResolvedValue({ isValid: true }),
    validateIdempotency: vi.fn().mockResolvedValue({ isValid: true }),
    getDefaultBankAccount: vi.fn().mockResolvedValue('bank-001'),
  } as unknown as PaymentValidationService;
}

function makeRepositoryMock(): IProcessingRequestRepository {
  return {
    save: vi.fn().mockImplementation(async (req: ProcessingRequest) => req),
    findByRequestId: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockImplementation(async (req: ProcessingRequest) => req),
  };
}

// ============================================================================
// PRISMA MOCK - shared base, overridden per test as needed
// ============================================================================

vi.mock('../../../../lib/prisma', () => {
  const orderPaymentCreate = vi.fn().mockImplementation(async ({ data }: any) => ({
    id: `op-${Math.random().toString(36).slice(2)}`,
    orderId: data.orderId,
    amount: data.amount,
    method: data.method,
    receiptNumber: data.receiptNumber || 'SPL-20260101-000001',
    createdAt: new Date(),
  }));

  const financialRecordCreate = vi.fn().mockImplementation(async ({ data }: any) => ({
    id: `fr-${Math.random().toString(36).slice(2)}`,
    paymentMethod: data.paymentMethod,
    amount: data.amount,
    bankAccountId: data.bankAccountId,
  }));

  const bankAccountFindUnique = vi.fn().mockResolvedValue({
    id: 'bank-001',
    currentBalance: 10000,
    version: 1,
    name: 'Caja Principal',
  });

  const bankAccountUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

  const transactionFn = vi.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
    const tx = {
      orderPayment: { create: orderPaymentCreate },
      financialRecord: { create: financialRecordCreate },
      bankAccount: { findUnique: bankAccountFindUnique, updateMany: bankAccountUpdateMany },
      clientCredit: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      clientAccount: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    return callback(tx);
  });

  return {
    prisma: {
      $transaction: transactionFn,
      processingRequest: { findUnique: vi.fn().mockResolvedValue(null) },
    },
  };
});

// ============================================================================
// SUITE 1: COMPLETE SPLIT PAYMENT FLOW
// ============================================================================

describe('Integration: Complete Split Payment Flow', () => {
  let validationService: PaymentValidationService;
  let repository: IProcessingRequestRepository;
  let useCase: ProcessSplitPaymentUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    validationService = makeValidationServiceMock();
    repository = makeRepositoryMock();
    useCase = new ProcessSplitPaymentUseCase(repository, validationService);
  });

  it('processes a split payment with two payment methods and two orders', async () => {
    const dto: ProcessSplitPaymentDTO = {
      orders: [
        { orderId: 'order-001', amount: 100 },
        { orderId: 'order-002', amount: 150 },
      ],
      payments: [
        { method: 'EFECTIVO', amount: 150, bankAccountId: 'bank-001' },
        { method: 'TRANSFERENCIA', amount: 100, bankAccountId: 'bank-002' },
      ],
      total: 250,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    const value = result.getValue() as SplitPaymentResponse;
    expect(value.success).toBe(true);
    expect(value.orderPayments).toHaveLength(2);
    expect(value.financialRecords).toHaveLength(2);
    expect(value.receiptNumber).toBeTruthy();
  });

  it('creates one OrderPayment per order regardless of payment method count', async () => {
    const dto: ProcessSplitPaymentDTO = {
      orders: [
        { orderId: 'order-001', amount: 80 },
        { orderId: 'order-002', amount: 70 },
        { orderId: 'order-003', amount: 50 },
      ],
      payments: [
        { method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' },
        { method: 'TRANSFERENCIA', amount: 100, bankAccountId: 'bank-002' },
      ],
      total: 200,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().orderPayments).toHaveLength(3);
  });

  it('creates one FinancialRecord per payment method regardless of order count', async () => {
    const dto: ProcessSplitPaymentDTO = {
      orders: [
        { orderId: 'order-001', amount: 60 },
        { orderId: 'order-002', amount: 60 },
        { orderId: 'order-003', amount: 60 },
      ],
      payments: [
        { method: 'EFECTIVO', amount: 90, bankAccountId: 'bank-001' },
        { method: 'TRANSFERENCIA', amount: 90, bankAccountId: 'bank-002' },
      ],
      total: 180,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().financialRecords).toHaveLength(2);
  });

  it('preserves original order amounts in OrderPayment records', async () => {
    const dto: ProcessSplitPaymentDTO = {
      orders: [
        { orderId: 'order-001', amount: 300 },
        { orderId: 'order-002', amount: 200 },
      ],
      payments: [
        { method: 'EFECTIVO', amount: 250, bankAccountId: 'bank-001' },
        { method: 'TRANSFERENCIA', amount: 250, bankAccountId: 'bank-002' },
      ],
      total: 500,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    const orderAmounts = result.getValue().orderPayments.map(op => op.amount);
    expect(orderAmounts).toContain(300);
    expect(orderAmounts).toContain(200);
  });

  it('all three payment methods (EFECTIVO, TRANSFERENCIA, BILLETERA_VIRTUAL) in one payment', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn().mockResolvedValue({
              id: 'op-multi',
              orderId: 'order-001',
              amount: 300,
              method: 'SPLIT_PAYMENT',
              receiptNumber: 'SPL-MULTI-001',
              createdAt: new Date(),
            }),
          },
          financialRecord: {
            create: vi.fn()
              .mockResolvedValueOnce({ id: 'fr-1', paymentMethod: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' })
              .mockResolvedValueOnce({ id: 'fr-2', paymentMethod: 'TRANSFERENCIA', amount: 100, bankAccountId: 'bank-002' })
              .mockResolvedValueOnce({ id: 'fr-3', paymentMethod: 'BILLETERA_VIRTUAL', amount: 100, bankAccountId: 'bank-001' }),
          },
          bankAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'bank-001', currentBalance: 5000, version: 1, name: 'Caja' }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          clientCredit: {
            findMany: vi.fn().mockResolvedValue([{ id: 'credit-001', remainingAmount: 200, version: 1 }]),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          clientAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'ca-001', totalCreditAvailable: 200, version: 1 }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 300 }],
      payments: [
        { method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' },
        { method: 'TRANSFERENCIA', amount: 100, bankAccountId: 'bank-002' },
        { method: 'BILLETERA_VIRTUAL', amount: 100 },
      ],
      total: 300,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().financialRecords).toHaveLength(3);
  });

  it('marks processing request as COMPLETED on success', async () => {
    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    await useCase.execute(dto);

    expect(repository.update).toHaveBeenCalledOnce();
    const saved = (repository.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProcessingRequest;
    expect(saved.status).toBe('COMPLETED');
  });

  it('all validation phases are called in the correct order', async () => {
    const callOrder: string[] = [];
    (validationService.validateIdempotency as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('idempotency');
      return { isValid: true };
    });
    (validationService.validatePaymentTotals as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push('totals');
      return { isValid: true };
    });
    (validationService.validatePositiveAmounts as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push('positive');
      return { isValid: true };
    });
    (validationService.validateOrdersExist as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('orders');
      return { success: true, data: [{ id: 'order-001', clientId: 'client-001', clientName: 'Test', status: 'PENDING', total: 100 }] };
    });
    (validationService.validateBankAccounts as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('bank');
      return { isValid: true };
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    await useCase.execute(dto);

    expect(callOrder[0]).toBe('idempotency');
    expect(callOrder[1]).toBe('totals');
    expect(callOrder).toContain('orders');
    expect(callOrder).toContain('bank');
  });
});

// ============================================================================
// SUITE 2: ERROR SCENARIOS AND ROLLBACK
// ============================================================================

describe('Integration: Error Scenarios and Rollback', () => {
  let validationService: PaymentValidationService;
  let repository: IProcessingRequestRepository;
  let useCase: ProcessSplitPaymentUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    validationService = makeValidationServiceMock();
    repository = makeRepositoryMock();
    useCase = new ProcessSplitPaymentUseCase(repository, validationService);
  });

  it('fails and marks request FAILED when payment totals do not match', async () => {
    (validationService.validatePaymentTotals as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isValid: false,
      error: 'Payment total (80.00) does not match expected total (100.00)',
      code: 'PAYMENT_TOTAL_MISMATCH',
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 80, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('does not match');
    const saved = (repository.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProcessingRequest;
    expect(saved.status).toBe('FAILED');
  });

  it('fails when bank account is not found', async () => {
    (validationService.validateBankAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      isValid: false,
      error: 'Bank accounts not found or inactive: bank-999',
      code: 'BANK_ACCOUNT_NOT_FOUND',
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-999' }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Bank accounts not found');
    const saved = (repository.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProcessingRequest;
    expect(saved.status).toBe('FAILED');
  });

  it('fails when wallet balance is insufficient', async () => {
    (validationService.validateWalletBalance as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      isValid: false,
      error: 'Insufficient wallet balance. Available: 50.00, Requested: 200.00',
      code: 'WALLET_INSUFFICIENT',
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 200 }],
      payments: [{ method: 'BILLETERA_VIRTUAL', amount: 200 }],
      total: 200,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Insufficient wallet balance');
    const saved = (repository.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProcessingRequest;
    expect(saved.status).toBe('FAILED');
  });

  it('fails when order does not exist', async () => {
    (validationService.validateOrdersExist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      error: 'Orders not found: order-999',
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-999', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('not found');
  });

  it('fails when any amount is negative', async () => {
    (validationService.validatePositiveAmounts as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isValid: false,
      error: 'Negative amounts are not allowed: -50',
      code: 'NEGATIVE_AMOUNT',
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: -50 }],
      payments: [{ method: 'EFECTIVO', amount: -50, bankAccountId: 'bank-001' }],
      total: -50,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Negative amounts');
  });

  it('rolls back: transaction is not committed when bank account findUnique throws', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn().mockResolvedValue({
              id: 'op-001',
              orderId: 'order-001',
              amount: 100,
              method: 'SPLIT_PAYMENT',
              receiptNumber: 'SPL-001',
              createdAt: new Date(),
            }),
          },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-001', paymentMethod: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }),
          },
          bankAccount: {
            findUnique: vi.fn().mockRejectedValue(new Error('DB connection lost')),
            updateMany: vi.fn(),
          },
          clientCredit: { findMany: vi.fn().mockResolvedValue([]) },
          clientAccount: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        // Simulate transaction rollback by re-throwing
        throw await callback(tx).catch((e: Error) => e);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    const saved = (repository.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProcessingRequest;
    expect(saved.status).toBe('FAILED');
  });

  it('no partial state: processing request is marked FAILED when transaction throws', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Simulated transaction failure')
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(repository.update).toHaveBeenCalled();
    const saved = (repository.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProcessingRequest;
    expect(saved.status).toBe('FAILED');
    expect(saved.error).toContain('Simulated transaction failure');
  });

  it('does not call transaction when pre-validation fails', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (validationService.validatePaymentTotals as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isValid: false,
      error: 'Mismatch',
      code: 'PAYMENT_TOTAL_MISMATCH',
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 50, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    await useCase.execute(dto);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ============================================================================
// SUITE 3: CONCURRENT PAYMENT PROCESSING (OPTIMISTIC LOCKING)
// ============================================================================

describe('Integration: Concurrent Payment Processing', () => {
  let validationService: PaymentValidationService;
  let repository: IProcessingRequestRepository;
  let useCase: ProcessSplitPaymentUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    validationService = makeValidationServiceMock();
    repository = makeRepositoryMock();
    useCase = new ProcessSplitPaymentUseCase(repository, validationService);
  });

  it('fails with ConcurrencyError when bank account optimistic lock fails (count=0)', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn().mockResolvedValue({
              id: 'op-001',
              orderId: 'order-001',
              amount: 100,
              method: 'SPLIT_PAYMENT',
              receiptNumber: 'SPL-001',
              createdAt: new Date(),
            }),
          },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-001', paymentMethod: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }),
          },
          bankAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'bank-001', currentBalance: 5000, version: 1, name: 'Caja' }),
            // Simulate concurrent modification: updateMany returns count=0
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          clientCredit: { findMany: vi.fn().mockResolvedValue([]) },
          clientAccount: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(result.error).toMatch(/modified by another transaction|concurren/i);
  });

  it('fails with ConcurrencyError when client credit optimistic lock fails', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn().mockResolvedValue({
              id: 'op-wallet',
              orderId: 'order-001',
              amount: 100,
              method: 'SPLIT_PAYMENT',
              receiptNumber: 'SPL-WALLET-001',
              createdAt: new Date(),
            }),
          },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-wallet', paymentMethod: 'BILLETERA_VIRTUAL', amount: 100, bankAccountId: 'bank-001' }),
          },
          bankAccount: {
            findUnique: vi.fn().mockResolvedValue(null),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          clientCredit: {
            findMany: vi.fn().mockResolvedValue([{ id: 'credit-001', remainingAmount: 200, version: 1 }]),
            // Simulate concurrent modification: updateMany returns count=0
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          clientAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'ca-001', totalCreditAvailable: 200, version: 1 }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'BILLETERA_VIRTUAL', amount: 100 }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(result.error).toMatch(/modified by another transaction|concurren/i);
  });

  it('fails with ConcurrencyError when client account optimistic lock fails', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn().mockResolvedValue({
              id: 'op-wallet',
              orderId: 'order-001',
              amount: 100,
              method: 'SPLIT_PAYMENT',
              receiptNumber: 'SPL-WALLET-001',
              createdAt: new Date(),
            }),
          },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-wallet', paymentMethod: 'BILLETERA_VIRTUAL', amount: 100, bankAccountId: 'bank-001' }),
          },
          bankAccount: {
            findUnique: vi.fn().mockResolvedValue(null),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          clientCredit: {
            findMany: vi.fn().mockResolvedValue([{ id: 'credit-001', remainingAmount: 200, version: 1 }]),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          clientAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'ca-001', totalCreditAvailable: 200, version: 1 }),
            // Simulate concurrent modification on client account
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'BILLETERA_VIRTUAL', amount: 100 }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(result.error).toMatch(/modified by another transaction|concurren/i);
  });

  it('idempotency: returns cached result for a duplicate completed request', async () => {
    const cachedResponse: SplitPaymentResponse = {
      success: true,
      receiptNumber: 'SPL-CACHED-001',
      orderPayments: [
        { orderId: 'order-001', paymentId: 'op-cached-1', amount: 100 },
        { orderId: 'order-002', paymentId: 'op-cached-2', amount: 150 },
      ],
      financialRecords: [
        { id: 'fr-cached-1', method: 'EFECTIVO', amount: 150, bankAccountId: 'bank-001' },
        { id: 'fr-cached-2', method: 'TRANSFERENCIA', amount: 100, bankAccountId: 'bank-002' },
      ],
    };

    (validationService.validateIdempotency as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      isValid: false,
      code: 'REQUEST_ALREADY_COMPLETED',
      details: { result: cachedResponse },
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [
        { orderId: 'order-001', amount: 100 },
        { orderId: 'order-002', amount: 150 },
      ],
      payments: [
        { method: 'EFECTIVO', amount: 150, bankAccountId: 'bank-001' },
        { method: 'TRANSFERENCIA', amount: 100, bankAccountId: 'bank-002' },
      ],
      total: 250,
      requestId: 'already-done-request-id',
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().receiptNumber).toBe('SPL-CACHED-001');
    expect(result.getValue().orderPayments).toHaveLength(2);
  });

  it('rejects a duplicate in-progress request', async () => {
    (validationService.validateIdempotency as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      isValid: false,
      error: 'Request is already being processed',
      code: 'REQUEST_IN_PROGRESS',
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: 'in-progress-request-id',
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('already being processed');
  });
});

// ============================================================================
// SUITE 4: WALLET PAYMENT WITH MULTIPLE CREDITS (FIFO)
// ============================================================================

describe('Integration: Wallet Payment with Multiple Credits (FIFO)', () => {
  let validationService: PaymentValidationService;
  let repository: IProcessingRequestRepository;
  let useCase: ProcessSplitPaymentUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    validationService = makeValidationServiceMock();
    repository = makeRepositoryMock();
    useCase = new ProcessSplitPaymentUseCase(repository, validationService);
  });

  function makeWalletTx(credits: Array<{ id: string; remainingAmount: number; version: number }>) {
    return async (callback: (tx: any) => Promise<any>) => {
      const updateManyCalls: any[] = [];
      const tx = {
        orderPayment: {
          create: vi.fn().mockResolvedValue({
            id: 'op-wallet',
            orderId: 'order-001',
            amount: 200,
            method: 'SPLIT_PAYMENT',
            receiptNumber: 'SPL-WALLET-001',
            createdAt: new Date(),
          }),
        },
        financialRecord: {
          create: vi.fn().mockResolvedValue({ id: 'fr-wallet', paymentMethod: 'BILLETERA_VIRTUAL', amount: 200, bankAccountId: 'bank-001' }),
        },
        bankAccount: {
          findUnique: vi.fn().mockResolvedValue(null),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        clientCredit: {
          findMany: vi.fn().mockResolvedValue(credits),
          updateMany: vi.fn().mockImplementation(async (args: any) => {
            updateManyCalls.push(args);
            return { count: 1 };
          }),
        },
        clientAccount: {
          findUnique: vi.fn().mockResolvedValue({ id: 'ca-001', totalCreditAvailable: 500, version: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        _updateManyCalls: updateManyCalls,
      };
      const result = await callback(tx);
      (result as any).__updateManyCalls = updateManyCalls;
      return result;
    };
  }

  it('consumes a single credit when it covers the full wallet amount', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      makeWalletTx([{ id: 'credit-001', remainingAmount: 300, version: 1 }])
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 200 }],
      payments: [{ method: 'BILLETERA_VIRTUAL', amount: 200 }],
      total: 200,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);
    expect(result.isSuccess).toBe(true);
  });

  it('consumes multiple credits in FIFO order when one credit is insufficient', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    const creditUpdateSpy = vi.fn().mockResolvedValue({ count: 1 });

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn().mockResolvedValue({
              id: 'op-wallet',
              orderId: 'order-001',
              amount: 200,
              method: 'SPLIT_PAYMENT',
              receiptNumber: 'SPL-WALLET-001',
              createdAt: new Date(),
            }),
          },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-wallet', paymentMethod: 'BILLETERA_VIRTUAL', amount: 200, bankAccountId: 'bank-001' }),
          },
          bankAccount: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          clientCredit: {
            // Two credits: 80 + 150 = 230 >= 200 (FIFO: oldest first)
            findMany: vi.fn().mockResolvedValue([
              { id: 'credit-old', remainingAmount: 80, version: 1 },
              { id: 'credit-new', remainingAmount: 150, version: 2 },
            ]),
            updateMany: creditUpdateSpy,
          },
          clientAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'ca-001', totalCreditAvailable: 230, version: 1 }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 200 }],
      payments: [{ method: 'BILLETERA_VIRTUAL', amount: 200 }],
      total: 200,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    // Both credits should have been updated (FIFO consumption)
    expect(creditUpdateSpy).toHaveBeenCalledTimes(2);
    // First call should target the oldest credit
    expect(creditUpdateSpy.mock.calls[0][0].where.id).toBe('credit-old');
    // Second call should target the newer credit
    expect(creditUpdateSpy.mock.calls[1][0].where.id).toBe('credit-new');
  });

  it('marks a fully consumed credit as USED', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    const creditUpdateSpy = vi.fn().mockResolvedValue({ count: 1 });

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn().mockResolvedValue({
              id: 'op-wallet',
              orderId: 'order-001',
              amount: 100,
              method: 'SPLIT_PAYMENT',
              receiptNumber: 'SPL-001',
              createdAt: new Date(),
            }),
          },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-wallet', paymentMethod: 'BILLETERA_VIRTUAL', amount: 100, bankAccountId: 'bank-001' }),
          },
          bankAccount: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          clientCredit: {
            findMany: vi.fn().mockResolvedValue([{ id: 'credit-001', remainingAmount: 100, version: 1 }]),
            updateMany: creditUpdateSpy,
          },
          clientAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'ca-001', totalCreditAvailable: 100, version: 1 }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'BILLETERA_VIRTUAL', amount: 100 }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    await useCase.execute(dto);

    // The credit update should set status to USED when fully consumed
    const updateCall = creditUpdateSpy.mock.calls[0][0];
    expect(updateCall.data.status).toBe('USED');
  });

  it('leaves a partially consumed credit as AVAILABLE', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    const creditUpdateSpy = vi.fn().mockResolvedValue({ count: 1 });

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn().mockResolvedValue({
              id: 'op-wallet',
              orderId: 'order-001',
              amount: 50,
              method: 'SPLIT_PAYMENT',
              receiptNumber: 'SPL-001',
              createdAt: new Date(),
            }),
          },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-wallet', paymentMethod: 'BILLETERA_VIRTUAL', amount: 50, bankAccountId: 'bank-001' }),
          },
          bankAccount: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          clientCredit: {
            findMany: vi.fn().mockResolvedValue([{ id: 'credit-001', remainingAmount: 200, version: 1 }]),
            updateMany: creditUpdateSpy,
          },
          clientAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'ca-001', totalCreditAvailable: 200, version: 1 }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 50 }],
      payments: [{ method: 'BILLETERA_VIRTUAL', amount: 50 }],
      total: 50,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    await useCase.execute(dto);

    const updateCall = creditUpdateSpy.mock.calls[0][0];
    expect(updateCall.data.status).toBe('AVAILABLE');
  });

  it('fails with FinancialIntegrityError when credits are insufficient at deduction time', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn().mockResolvedValue({
              id: 'op-wallet',
              orderId: 'order-001',
              amount: 500,
              method: 'SPLIT_PAYMENT',
              receiptNumber: 'SPL-001',
              createdAt: new Date(),
            }),
          },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-wallet', paymentMethod: 'BILLETERA_VIRTUAL', amount: 500, bankAccountId: 'bank-001' }),
          },
          bankAccount: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          clientCredit: {
            // Only 100 available but 500 requested
            findMany: vi.fn().mockResolvedValue([{ id: 'credit-001', remainingAmount: 100, version: 1 }]),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          clientAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'ca-001', totalCreditAvailable: 100, version: 1 }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 500 }],
      payments: [{ method: 'BILLETERA_VIRTUAL', amount: 500 }],
      total: 500,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isFailure).toBe(true);
    expect(result.error).toMatch(/Insufficient wallet balance|Missing/i);
  });
});

// ============================================================================
// SUITE 5: MULTI-ORDER DISTRIBUTION ACROSS PAYMENT METHODS
// ============================================================================

describe('Integration: Multi-Order Distribution Across Payment Methods', () => {
  let validationService: PaymentValidationService;
  let repository: IProcessingRequestRepository;
  let useCase: ProcessSplitPaymentUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    validationService = makeValidationServiceMock();
    repository = makeRepositoryMock();
    useCase = new ProcessSplitPaymentUseCase(repository, validationService);
  });

  it('distributes 3 orders across 2 payment methods correctly', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    const orderPaymentCreateSpy = vi.fn()
      .mockResolvedValueOnce({ id: 'op-1', orderId: 'order-001', amount: 100, method: 'SPLIT_PAYMENT', receiptNumber: 'SPL-001', createdAt: new Date() })
      .mockResolvedValueOnce({ id: 'op-2', orderId: 'order-002', amount: 200, method: 'SPLIT_PAYMENT', receiptNumber: 'SPL-001', createdAt: new Date() })
      .mockResolvedValueOnce({ id: 'op-3', orderId: 'order-003', amount: 150, method: 'SPLIT_PAYMENT', receiptNumber: 'SPL-001', createdAt: new Date() });

    const financialRecordCreateSpy = vi.fn()
      .mockResolvedValueOnce({ id: 'fr-1', paymentMethod: 'EFECTIVO', amount: 250, bankAccountId: 'bank-001' })
      .mockResolvedValueOnce({ id: 'fr-2', paymentMethod: 'TRANSFERENCIA', amount: 200, bankAccountId: 'bank-002' });

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: { create: orderPaymentCreateSpy },
          financialRecord: { create: financialRecordCreateSpy },
          bankAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'bank-001', currentBalance: 5000, version: 1, name: 'Caja' }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          clientCredit: { findMany: vi.fn().mockResolvedValue([]) },
          clientAccount: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        return callback(tx);
      }
    );

    (validationService.validateOrdersExist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'order-001', clientId: 'client-001', clientName: 'Test Client', status: 'PENDING', total: 100 },
        { id: 'order-002', clientId: 'client-001', clientName: 'Test Client', status: 'PENDING', total: 200 },
        { id: 'order-003', clientId: 'client-001', clientName: 'Test Client', status: 'PENDING', total: 150 },
      ],
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [
        { orderId: 'order-001', amount: 100 },
        { orderId: 'order-002', amount: 200 },
        { orderId: 'order-003', amount: 150 },
      ],
      payments: [
        { method: 'EFECTIVO', amount: 250, bankAccountId: 'bank-001' },
        { method: 'TRANSFERENCIA', amount: 200, bankAccountId: 'bank-002' },
      ],
      total: 450,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().orderPayments).toHaveLength(3);
    expect(result.getValue().financialRecords).toHaveLength(2);
    // Order amounts are preserved exactly
    const amounts = result.getValue().orderPayments.map(op => op.amount);
    expect(amounts).toContain(100);
    expect(amounts).toContain(200);
    expect(amounts).toContain(150);
  });

  it('order amounts are NOT redistributed between orders', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    const orderPaymentCreateSpy = vi.fn()
      .mockResolvedValueOnce({ id: 'op-1', orderId: 'order-001', amount: 300, method: 'SPLIT_PAYMENT', receiptNumber: 'SPL-001', createdAt: new Date() })
      .mockResolvedValueOnce({ id: 'op-2', orderId: 'order-002', amount: 200, method: 'SPLIT_PAYMENT', receiptNumber: 'SPL-001', createdAt: new Date() });

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: { create: orderPaymentCreateSpy },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-1', paymentMethod: 'EFECTIVO', amount: 500, bankAccountId: 'bank-001' }),
          },
          bankAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'bank-001', currentBalance: 5000, version: 1, name: 'Caja' }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          clientCredit: { findMany: vi.fn().mockResolvedValue([]) },
          clientAccount: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        return callback(tx);
      }
    );

    (validationService.validateOrdersExist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'order-001', clientId: 'client-001', clientName: 'Test Client', status: 'PENDING', total: 300 },
        { id: 'order-002', clientId: 'client-001', clientName: 'Test Client', status: 'PENDING', total: 200 },
      ],
    });

    const dto: ProcessSplitPaymentDTO = {
      orders: [
        { orderId: 'order-001', amount: 300 },
        { orderId: 'order-002', amount: 200 },
      ],
      payments: [{ method: 'EFECTIVO', amount: 500, bankAccountId: 'bank-001' }],
      total: 500,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    // Verify the create calls used the original amounts
    expect(orderPaymentCreateSpy.mock.calls[0][0].data.amount).toBe(300);
    expect(orderPaymentCreateSpy.mock.calls[1][0].data.amount).toBe(200);
  });

  it('all orders share the same receiptNumber', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn()
              .mockResolvedValueOnce({ id: 'op-1', orderId: 'order-001', amount: 100, method: 'SPLIT_PAYMENT', receiptNumber: 'SPL-SHARED-001', createdAt: new Date() })
              .mockResolvedValueOnce({ id: 'op-2', orderId: 'order-002', amount: 100, method: 'SPLIT_PAYMENT', receiptNumber: 'SPL-SHARED-001', createdAt: new Date() }),
          },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-1', paymentMethod: 'EFECTIVO', amount: 200, bankAccountId: 'bank-001' }),
          },
          bankAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'bank-001', currentBalance: 5000, version: 1, name: 'Caja' }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          clientCredit: { findMany: vi.fn().mockResolvedValue([]) },
          clientAccount: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [
        { orderId: 'order-001', amount: 100 },
        { orderId: 'order-002', amount: 100 },
      ],
      payments: [{ method: 'EFECTIVO', amount: 200, bankAccountId: 'bank-001' }],
      total: 200,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().receiptNumber).toBe('SPL-SHARED-001');
  });

  it('bank account balance is updated once per non-wallet payment method', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    const bankUpdateSpy = vi.fn().mockResolvedValue({ count: 1 });

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn()
              .mockResolvedValueOnce({ id: 'op-1', orderId: 'order-001', amount: 100, method: 'SPLIT_PAYMENT', receiptNumber: 'SPL-001', createdAt: new Date() })
              .mockResolvedValueOnce({ id: 'op-2', orderId: 'order-002', amount: 100, method: 'SPLIT_PAYMENT', receiptNumber: 'SPL-001', createdAt: new Date() }),
          },
          financialRecord: {
            create: vi.fn()
              .mockResolvedValueOnce({ id: 'fr-1', paymentMethod: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' })
              .mockResolvedValueOnce({ id: 'fr-2', paymentMethod: 'TRANSFERENCIA', amount: 100, bankAccountId: 'bank-002' }),
          },
          bankAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'bank-001', currentBalance: 5000, version: 1, name: 'Caja' }),
            updateMany: bankUpdateSpy,
          },
          clientCredit: { findMany: vi.fn().mockResolvedValue([]) },
          clientAccount: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [
        { orderId: 'order-001', amount: 100 },
        { orderId: 'order-002', amount: 100 },
      ],
      payments: [
        { method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' },
        { method: 'TRANSFERENCIA', amount: 100, bankAccountId: 'bank-002' },
      ],
      total: 200,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    // One bank account update per payment method (2 methods, 2 updates)
    expect(bankUpdateSpy).toHaveBeenCalledTimes(2);
  });

  it('wallet payment does NOT trigger bank account balance update', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    const bankUpdateSpy = vi.fn().mockResolvedValue({ count: 1 });

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          orderPayment: {
            create: vi.fn().mockResolvedValue({ id: 'op-1', orderId: 'order-001', amount: 100, method: 'SPLIT_PAYMENT', receiptNumber: 'SPL-001', createdAt: new Date() }),
          },
          financialRecord: {
            create: vi.fn().mockResolvedValue({ id: 'fr-1', paymentMethod: 'BILLETERA_VIRTUAL', amount: 100, bankAccountId: 'bank-001' }),
          },
          bankAccount: {
            findUnique: vi.fn().mockResolvedValue(null),
            updateMany: bankUpdateSpy,
          },
          clientCredit: {
            findMany: vi.fn().mockResolvedValue([{ id: 'credit-001', remainingAmount: 200, version: 1 }]),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          clientAccount: {
            findUnique: vi.fn().mockResolvedValue({ id: 'ca-001', totalCreditAvailable: 200, version: 1 }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      }
    );

    const dto: ProcessSplitPaymentDTO = {
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'BILLETERA_VIRTUAL', amount: 100 }],
      total: 100,
      requestId: makeRequestId(),
      clientId: 'client-001',
      createdBy: 'cashier-01',
    };

    const result = await useCase.execute(dto);

    expect(result.isSuccess).toBe(true);
    // Bank account updateMany should NOT be called for wallet payments
    expect(bankUpdateSpy).not.toHaveBeenCalled();
  });
});
