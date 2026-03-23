/**
 * E2E-style tests for the Split Payment feature.
 *
 * Strategy: No supertest available, so we test the HTTP boundary by invoking
 * SplitPaymentController.processSplitPayment directly with mock req/res objects.
 * This exercises the full path: controller → use case → domain → (mocked) DB → response.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SplitPaymentController } from '../../infrastructure/SplitPaymentController';
import { ProcessSplitPaymentUseCase } from '../ProcessSplitPayment.usecase';
import { PaymentValidationService } from '../../domain/PaymentValidationService';
import { IProcessingRequestRepository } from '../../domain/IProcessingRequestRepository';
import { ProcessingRequest } from '../../domain/ProcessingRequest.entity';
import type { SplitPaymentResponse } from '../ProcessSplitPayment.usecase';

// ============================================================================
// MOCK HELPERS
// ============================================================================

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function makeReq(body: any, user?: { username: string }): any {
  return { body, user: user ?? { username: 'cashier-01' } };
}

function makeRequestId(): string {
  return `split-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeValidationServiceMock(): PaymentValidationService {
  return {
    validatePaymentTotals: vi.fn().mockReturnValue({ isValid: true }),
    validatePositiveAmounts: vi.fn().mockReturnValue({ isValid: true }),
    validateOrdersExist: vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'order-001', clientId: 'client-001', clientName: 'Test Client', status: 'PENDING', total: 100 }],
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
// PRISMA MOCK — shared across all suites
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

  // order.findUnique used by controller.getOrderClientId
  const orderFindUnique = vi.fn().mockResolvedValue({ clientId: 'client-001' });

  return {
    prisma: {
      $transaction: transactionFn,
      processingRequest: { findUnique: vi.fn().mockResolvedValue(null) },
      order: { findUnique: orderFindUnique },
    },
  };
});

// ============================================================================
// SUITE 1: FULL FLOW — HTTP request → controller → use case → domain → DB → response
// ============================================================================

describe('E2E: Full Split Payment Flow', () => {
  let controller: SplitPaymentController;
  let useCase: ProcessSplitPaymentUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    const validationService = makeValidationServiceMock();
    const repository = makeRepositoryMock();
    useCase = new ProcessSplitPaymentUseCase(repository, validationService);
    controller = new SplitPaymentController(useCase);
  });

  it('returns 201 with success payload for a valid split payment', async () => {
    const req = makeReq({
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
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.orderPayments).toHaveLength(2);
    expect(body.data.financialRecords).toHaveLength(2);
    expect(body.data.receiptNumber).toBeTruthy();
  });

  it('response shape matches the frontend contract (SplitPaymentResponse)', async () => {
    const req = makeReq({
      orders: [{ orderId: 'order-001', amount: 200 }],
      payments: [{ method: 'EFECTIVO', amount: 200, bankAccountId: 'bank-001' }],
      total: 200,
      requestId: makeRequestId(),
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('data');
    const data: SplitPaymentResponse = body.data;
    expect(data).toHaveProperty('receiptNumber');
    expect(Array.isArray(data.orderPayments)).toBe(true);
    expect(Array.isArray(data.financialRecords)).toBe(true);
    // Each orderPayment has the expected shape
    for (const op of data.orderPayments) {
      expect(op).toHaveProperty('orderId');
      expect(op).toHaveProperty('paymentId');
      expect(op).toHaveProperty('amount');
    }
    // Each financialRecord has the expected shape
    for (const fr of data.financialRecords) {
      expect(fr).toHaveProperty('id');
      expect(fr).toHaveProperty('method');
      expect(fr).toHaveProperty('amount');
      expect(fr).toHaveProperty('bankAccountId');
    }
  });

  it('creates one OrderPayment per order and one FinancialRecord per payment method', async () => {
    const req = makeReq({
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
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.orderPayments).toHaveLength(3);
    expect(body.data.financialRecords).toHaveLength(2);
  });

  it('preserves original order amounts in the response', async () => {
    const req = makeReq({
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
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    const body = res.json.mock.calls[0][0];
    const amounts = body.data.orderPayments.map((op: any) => op.amount);
    expect(amounts).toContain(300);
    expect(amounts).toContain(200);
  });
});

// ============================================================================
// SUITE 2: IDEMPOTENCY ACROSS FULL STACK
// ============================================================================

describe('E2E: Idempotency Across Full Stack', () => {
  let controller: SplitPaymentController;
  let validationService: PaymentValidationService;
  let repository: IProcessingRequestRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    validationService = makeValidationServiceMock();
    repository = makeRepositoryMock();
    const useCase = new ProcessSplitPaymentUseCase(repository, validationService);
    controller = new SplitPaymentController(useCase);
  });

  it('returns 201 with cached result when requestId was already completed', async () => {
    const cachedResponse: SplitPaymentResponse = {
      success: true,
      receiptNumber: 'SPL-CACHED-001',
      orderPayments: [{ orderId: 'order-001', paymentId: 'op-cached', amount: 100 }],
      financialRecords: [{ id: 'fr-cached', method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
    };

    (validationService.validateIdempotency as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      isValid: false,
      code: 'REQUEST_ALREADY_COMPLETED',
      details: { result: cachedResponse },
    });

    const req = makeReq({
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: 'already-done-request-id',
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.receiptNumber).toBe('SPL-CACHED-001');
    // No new DB writes should have happened
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('returns 400 when requestId is already in progress', async () => {
    (validationService.validateIdempotency as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      isValid: false,
      error: 'Request is already being processed',
      code: 'REQUEST_IN_PROGRESS',
    });

    const req = makeReq({
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: 'in-progress-request-id',
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('already being processed');
  });

  it('two calls with the same completed requestId return identical responses', async () => {
    const cachedResponse: SplitPaymentResponse = {
      success: true,
      receiptNumber: 'SPL-IDEM-001',
      orderPayments: [{ orderId: 'order-001', paymentId: 'op-idem', amount: 200 }],
      financialRecords: [{ id: 'fr-idem', method: 'TRANSFERENCIA', amount: 200, bankAccountId: 'bank-002' }],
    };

    // Both calls return the cached result
    (validationService.validateIdempotency as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        isValid: false,
        code: 'REQUEST_ALREADY_COMPLETED',
        details: { result: cachedResponse },
      });

    const body1 = makeReq({
      orders: [{ orderId: 'order-001', amount: 200 }],
      payments: [{ method: 'TRANSFERENCIA', amount: 200, bankAccountId: 'bank-002' }],
      total: 200,
      requestId: 'same-request-id',
    });
    const body2 = makeReq({
      orders: [{ orderId: 'order-001', amount: 200 }],
      payments: [{ method: 'TRANSFERENCIA', amount: 200, bankAccountId: 'bank-002' }],
      total: 200,
      requestId: 'same-request-id',
    });

    const res1 = makeRes();
    const res2 = makeRes();

    await controller.processSplitPayment(body1, res1);
    await controller.processSplitPayment(body2, res2);

    const r1 = res1.json.mock.calls[0][0];
    const r2 = res2.json.mock.calls[0][0];
    expect(r1.data.receiptNumber).toBe(r2.data.receiptNumber);
    expect(r1.data.orderPayments[0].paymentId).toBe(r2.data.orderPayments[0].paymentId);
  });
});

// ============================================================================
// SUITE 3: ERROR PROPAGATION — backend errors → correct HTTP status codes
// ============================================================================

describe('E2E: Error Propagation from Backend to HTTP Response', () => {
  let controller: SplitPaymentController;
  let validationService: PaymentValidationService;
  let repository: IProcessingRequestRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    validationService = makeValidationServiceMock();
    repository = makeRepositoryMock();
    const useCase = new ProcessSplitPaymentUseCase(repository, validationService);
    controller = new SplitPaymentController(useCase);
  });

  it('returns 400 when payment totals do not match', async () => {
    (validationService.validatePaymentTotals as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isValid: false,
      error: 'Payment total (80.00) does not match expected total (100.00)',
      code: 'PAYMENT_TOTAL_MISMATCH',
    });

    const req = makeReq({
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 80, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('does not match');
  });

  it('returns 400 when wallet balance is insufficient', async () => {
    (validationService.validateWalletBalance as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      isValid: false,
      error: 'Insufficient wallet balance. Available: 50.00, Requested: 200.00',
      code: 'WALLET_INSUFFICIENT',
    });

    const req = makeReq({
      orders: [{ orderId: 'order-001', amount: 200 }],
      payments: [{ method: 'BILLETERA_VIRTUAL', amount: 200 }],
      total: 200,
      requestId: makeRequestId(),
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('Insufficient wallet');
  });

  it('returns 400 when bank account is not found', async () => {
    (validationService.validateBankAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      isValid: false,
      error: 'Bank accounts not found or inactive: bank-999',
      code: 'BANK_ACCOUNT_NOT_FOUND',
    });

    const req = makeReq({
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-999' }],
      total: 100,
      requestId: makeRequestId(),
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('not found');
  });

  it('returns 400 when order does not exist', async () => {
    (validationService.validateOrdersExist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      error: 'Orders not found: order-999',
    });

    const req = makeReq({
      orders: [{ orderId: 'order-999', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('not found');
  });

  it('returns 500 when an unexpected DB error occurs during transaction', async () => {
    const { prisma } = await import('../../../../lib/prisma');
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Unexpected DB failure')
    );

    const req = makeReq({
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('error response always has success:false and error.message', async () => {
    (validationService.validatePaymentTotals as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isValid: false,
      error: 'Some validation error',
      code: 'VALIDATION_ERROR',
    });

    const req = makeReq({
      orders: [{ orderId: 'order-001', amount: 100 }],
      payments: [{ method: 'EFECTIVO', amount: 50, bankAccountId: 'bank-001' }],
      total: 100,
      requestId: makeRequestId(),
    });
    const res = makeRes();

    await controller.processSplitPayment(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error).toHaveProperty('message');
    expect(typeof body.error.message).toBe('string');
  });
});
