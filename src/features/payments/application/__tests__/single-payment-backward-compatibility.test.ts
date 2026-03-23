import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProcessSplitPaymentUseCase,
  ProcessSplitPaymentDTO,
  SplitPaymentResponse,
} from '../ProcessSplitPayment.usecase';
import { PaymentValidationService } from '../../domain/PaymentValidationService';
import { IProcessingRequestRepository } from '../../domain/IProcessingRequestRepository';
import { ProcessingRequest } from '../../domain/ProcessingRequest.entity';

function makeRequestId(): string {
  return `split-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function singlePaymentDTO(overrides: Partial<ProcessSplitPaymentDTO> = {}): ProcessSplitPaymentDTO {
  return {
    orders: [{ orderId: 'order-001', amount: 100 }],
    payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
    total: 100,
    requestId: makeRequestId(),
    clientId: 'client-001',
    createdBy: 'cashier-01',
    ...overrides,
  };
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

vi.mock('../../../../lib/prisma', () => {
  const orderPaymentCreate = vi.fn().mockResolvedValue({
    id: 'op-001',
    orderId: 'order-001',
    amount: 100,
    method: 'SPLIT_PAYMENT',
    receiptNumber: 'SPL-20260101-000001',
    createdAt: new Date(),
  });
  const financialRecordCreate = vi.fn().mockResolvedValue({
    id: 'fr-001',
    paymentMethod: 'EFECTIVO',
    amount: 100,
    bankAccountId: 'bank-001',
  });
  const bankAccountFindUnique = vi.fn().mockResolvedValue({
    id: 'bank-001',
    currentBalance: 5000,
    version: 1,
    name: 'Caja Principal',
  });
  const bankAccountUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const transactionFn = vi.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
    const tx = {
      orderPayment: { create: orderPaymentCreate },
      financialRecord: { create: financialRecordCreate },
      bankAccount: { findUnique: bankAccountFindUnique, updateMany: bankAccountUpdateMany },
      clientCredit: { findMany: vi.fn().mockResolvedValue([]) },
      clientAccount: { findUnique: vi.fn().mockResolvedValue(null) },
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

describe('Backward Compatibility - Single Payment Method Flows', () => {
  let validationService: PaymentValidationService;
  let repository: IProcessingRequestRepository;
  let useCase: ProcessSplitPaymentUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    validationService = makeValidationServiceMock();
    repository = makeRepositoryMock();
    useCase = new ProcessSplitPaymentUseCase(repository, validationService);
  });

  // Requirement 6.1 - Single payment behaves identically to current impl
  describe('Requirement 6.1 - Single payment method behaves identically', () => {
    it('succeeds with a single EFECTIVO payment covering the full total', async () => {
      const dto = singlePaymentDTO();
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      const value = result.getValue() as SplitPaymentResponse;
      expect(value.success).toBe(true);
      expect(value.orderPayments).toHaveLength(1);
      expect(value.orderPayments[0].orderId).toBe('order-001');
      expect(value.orderPayments[0].amount).toBe(100);
    });

    it('succeeds with a single TRANSFERENCIA payment', async () => {
      const dto = singlePaymentDTO({
        payments: [{ method: 'TRANSFERENCIA', amount: 100, bankAccountId: 'bank-002' }],
      });
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      expect(result.getValue().success).toBe(true);
    });

    it('succeeds with a single BILLETERA_VIRTUAL payment', async () => {
      const { prisma } = await import('../../../../lib/prisma');
      // Provide a wallet credit with enough balance
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
              create: vi.fn().mockResolvedValue({
                id: 'fr-wallet',
                paymentMethod: 'BILLETERA_VIRTUAL',
                amount: 100,
                bankAccountId: 'bank-001',
              }),
            },
            bankAccount: {
              findUnique: vi.fn().mockResolvedValue(null),
              updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            clientCredit: {
              findMany: vi.fn().mockResolvedValue([
                { id: 'credit-001', remainingAmount: 200, version: 1 },
              ]),
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
      const dto = singlePaymentDTO({
        payments: [{ method: 'BILLETERA_VIRTUAL', amount: 100 }],
      });
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      expect(result.getValue().success).toBe(true);
    });

    it('produces exactly one financial record for a single payment method', async () => {
      const dto = singlePaymentDTO();
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      expect(result.getValue().financialRecords).toHaveLength(1);
    });

    it('produces exactly one order payment record for a single order', async () => {
      const dto = singlePaymentDTO();
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      expect(result.getValue().orderPayments).toHaveLength(1);
    });

    it('returns a receiptNumber in the response', async () => {
      const dto = singlePaymentDTO();
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      expect(result.getValue().receiptNumber).toBeTruthy();
    });
  });

  // Requirement 6.2 - Both single and multiple payment workflows supported
  describe('Requirement 6.2 - Single and multiple payment workflows both supported', () => {
    it('accepts a single-element payments array (single method)', async () => {
      const dto = singlePaymentDTO({
        payments: [{ method: 'EFECTIVO', amount: 200, bankAccountId: 'bank-001' }],
        orders: [{ orderId: 'order-001', amount: 200 }],
        total: 200,
      });
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
    });

    it('accepts a multi-element payments array (split payment)', async () => {
      const dto: ProcessSplitPaymentDTO = {
        orders: [{ orderId: 'order-001', amount: 150 }],
        payments: [
          { method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' },
          { method: 'TRANSFERENCIA', amount: 50, bankAccountId: 'bank-002' },
        ],
        total: 150,
        requestId: makeRequestId(),
        clientId: 'client-001',
        createdBy: 'cashier-01',
      };
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
    });

    it('single-payment path calls the same validation pipeline as split-payment', async () => {
      const dto = singlePaymentDTO();
      await useCase.execute(dto);
      expect(validationService.validatePaymentTotals).toHaveBeenCalledOnce();
      expect(validationService.validatePositiveAmounts).toHaveBeenCalledOnce();
      expect(validationService.validateOrdersExist).toHaveBeenCalledOnce();
      expect(validationService.validateBankAccounts).toHaveBeenCalledOnce();
    });
  });

  // Requirement 6.3 - Both single and split payment scenarios handled
  describe('Requirement 6.3 - Single and split payment scenarios handled', () => {
    it('single payment: order amount equals payment amount equals total', async () => {
      const dto = singlePaymentDTO({
        total: 75,
        orders: [{ orderId: 'order-001', amount: 75 }],
        payments: [{ method: 'EFECTIVO', amount: 75, bankAccountId: 'bank-001' }],
      });
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
    });

    it('fails when single payment amount does not match total', async () => {
      (validationService.validatePaymentTotals as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        isValid: false,
        error: 'Payment total (80.00) does not match expected total (100.00)',
        code: 'PAYMENT_TOTAL_MISMATCH',
      });
      const dto = singlePaymentDTO({
        payments: [{ method: 'EFECTIVO', amount: 80, bankAccountId: 'bank-001' }],
      });
      const result = await useCase.execute(dto);
      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('does not match');
    });

    it('fails when single payment amount is negative', async () => {
      (validationService.validatePositiveAmounts as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        isValid: false,
        error: 'Negative amounts are not allowed: -50',
        code: 'NEGATIVE_AMOUNT',
      });
      const dto = singlePaymentDTO({
        payments: [{ method: 'EFECTIVO', amount: -50, bankAccountId: 'bank-001' }],
      });
      const result = await useCase.execute(dto);
      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('Negative amounts');
    });

    it('fails when the order referenced does not exist', async () => {
      (validationService.validateOrdersExist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: 'Orders not found: order-999',
      });
      const dto = singlePaymentDTO({ orders: [{ orderId: 'order-999', amount: 100 }] });
      const result = await useCase.execute(dto);
      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('not found');
    });
  });

  // Requirement 6.4 - Same API interface maintained for existing callers
  describe('Requirement 6.4 - API interface unchanged for existing callers', () => {
    it('DTO accepts orders, payments, total, requestId, clientId, createdBy fields', async () => {
      const dto: ProcessSplitPaymentDTO = {
        orders: [{ orderId: 'order-001', amount: 100 }],
        payments: [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'bank-001' }],
        total: 100,
        requestId: makeRequestId(),
        clientId: 'client-001',
        createdBy: 'cashier-01',
      };
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
    });

    it('response contains success, receiptNumber, orderPayments, financialRecords fields', async () => {
      const dto = singlePaymentDTO();
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      const value = result.getValue();
      expect(value).toHaveProperty('success');
      expect(value).toHaveProperty('receiptNumber');
      expect(value).toHaveProperty('orderPayments');
      expect(value).toHaveProperty('financialRecords');
    });

    it('orderPayments items contain orderId, paymentId, amount', async () => {
      const dto = singlePaymentDTO();
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      const op = result.getValue().orderPayments[0];
      expect(op).toHaveProperty('orderId');
      expect(op).toHaveProperty('paymentId');
      expect(op).toHaveProperty('amount');
    });

    it('financialRecords items contain id, method, amount, bankAccountId', async () => {
      const dto = singlePaymentDTO();
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      const fr = result.getValue().financialRecords[0];
      expect(fr).toHaveProperty('id');
      expect(fr).toHaveProperty('method');
      expect(fr).toHaveProperty('amount');
      expect(fr).toHaveProperty('bankAccountId');
    });

    it('returns Result.fail with a string error message on validation failure', async () => {
      (validationService.validatePaymentTotals as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        isValid: false,
        error: 'Order total (90.00) does not match expected total (100.00)',
        code: 'ORDER_TOTAL_MISMATCH',
      });
      const dto = singlePaymentDTO();
      const result = await useCase.execute(dto);
      expect(result.isFailure).toBe(true);
      expect(typeof result.error).toBe('string');
    });
  });

  // Requirement 6.5 - Existing receipts with single payments processed correctly
  describe('Requirement 6.5 - Legacy single-payment receipts processed correctly', () => {
    it('processes a legacy single-order, single-payment receipt end-to-end', async () => {
      const { prisma } = await import('../../../../lib/prisma');
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (callback: (tx: any) => Promise<any>) => {
          const tx = {
            orderPayment: {
              create: vi.fn().mockResolvedValue({
                id: 'op-legacy',
                orderId: 'legacy-order-001',
                amount: 250,
                method: 'SPLIT_PAYMENT',
                receiptNumber: 'SPL-LEGACY-001',
                createdAt: new Date(),
              }),
            },
            financialRecord: {
              create: vi.fn().mockResolvedValue({
                id: 'fr-legacy',
                paymentMethod: 'EFECTIVO',
                amount: 250,
                bankAccountId: 'bank-001',
              }),
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
        data: [{ id: 'legacy-order-001', clientId: 'client-001', clientName: 'Legacy Client', status: 'PENDING', total: 250 }],
      });
      const dto = singlePaymentDTO({
        orders: [{ orderId: 'legacy-order-001', amount: 250 }],
        payments: [{ method: 'EFECTIVO', amount: 250, bankAccountId: 'bank-001' }],
        total: 250,
      });
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      expect(result.getValue().success).toBe(true);
      expect(result.getValue().orderPayments[0].orderId).toBe('legacy-order-001');
    });

    it('idempotency: returns cached result for a previously completed request', async () => {
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
      const dto = singlePaymentDTO({ requestId: 'already-done-request-id' });
      const result = await useCase.execute(dto);
      expect(result.isSuccess).toBe(true);
      expect(result.getValue().receiptNumber).toBe('SPL-CACHED-001');
    });

    it('rejects a duplicate in-progress request gracefully', async () => {
      (validationService.validateIdempotency as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        isValid: false,
        error: 'Request is already being processed',
        code: 'REQUEST_IN_PROGRESS',
      });
      const dto = singlePaymentDTO({ requestId: 'in-progress-request-id' });
      const result = await useCase.execute(dto);
      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('already being processed');
    });

    it('marks the processing request as completed after a successful single payment', async () => {
      const dto = singlePaymentDTO();
      await useCase.execute(dto);
      expect(repository.update).toHaveBeenCalledOnce();
      const savedRequest = (repository.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProcessingRequest;
      expect(savedRequest.status).toBe('COMPLETED');
    });

    it('marks the processing request as failed when validation fails', async () => {
      (validationService.validatePaymentTotals as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        isValid: false,
        error: 'Payment total mismatch',
        code: 'PAYMENT_TOTAL_MISMATCH',
      });
      const dto = singlePaymentDTO();
      await useCase.execute(dto);
      expect(repository.update).toHaveBeenCalledOnce();
      const savedRequest = (repository.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProcessingRequest;
      expect(savedRequest.status).toBe('FAILED');
    });

    it('wallet validation is skipped when no BILLETERA_VIRTUAL payment is present', async () => {
      const dto = singlePaymentDTO();
      await useCase.execute(dto);
      expect(validationService.validateWalletBalance).not.toHaveBeenCalled();
    });

    it('wallet validation is invoked when BILLETERA_VIRTUAL is the single payment method', async () => {
      const dto = singlePaymentDTO({
        payments: [{ method: 'BILLETERA_VIRTUAL', amount: 100 }],
      });
      await useCase.execute(dto);
      expect(validationService.validateWalletBalance).toHaveBeenCalledOnce();
      expect(validationService.validateWalletBalance).toHaveBeenCalledWith('client-001', 100);
    });
  });

  // PaymentValidationService - pure unit tests (no DB)
  describe('PaymentValidationService - single payment validation (pure unit)', () => {
    let service: PaymentValidationService;

    beforeEach(() => {
      service = new PaymentValidationService();
    });

    it('validatePaymentTotals passes when single payment equals total', () => {
      const result = service.validatePaymentTotals(
        [{ orderId: 'o1', amount: 100 }],
        [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'b1' }],
        100,
      );
      expect(result.isValid).toBe(true);
    });

    it('validatePaymentTotals fails when single payment is less than total', () => {
      const result = service.validatePaymentTotals(
        [{ orderId: 'o1', amount: 100 }],
        [{ method: 'EFECTIVO', amount: 80, bankAccountId: 'b1' }],
        100,
      );
      expect(result.isValid).toBe(false);
      expect(result.code).toBe('PAYMENT_TOTAL_MISMATCH');
    });

    it('validatePaymentTotals fails when single payment exceeds total', () => {
      const result = service.validatePaymentTotals(
        [{ orderId: 'o1', amount: 100 }],
        [{ method: 'EFECTIVO', amount: 120, bankAccountId: 'b1' }],
        100,
      );
      expect(result.isValid).toBe(false);
      expect(result.code).toBe('PAYMENT_TOTAL_MISMATCH');
    });

    it('validatePaymentTotals fails when order total does not match declared total', () => {
      const result = service.validatePaymentTotals(
        [{ orderId: 'o1', amount: 90 }],
        [{ method: 'EFECTIVO', amount: 100, bankAccountId: 'b1' }],
        100,
      );
      expect(result.isValid).toBe(false);
      expect(result.code).toBe('ORDER_TOTAL_MISMATCH');
    });

    it('validatePaymentTotals allows small floating-point tolerance (< 0.01)', () => {
      const result = service.validatePaymentTotals(
        [{ orderId: 'o1', amount: 100.005 }],
        [{ method: 'EFECTIVO', amount: 100.005, bankAccountId: 'b1' }],
        100,
      );
      expect(result.isValid).toBe(true);
    });

    it('validatePositiveAmounts passes for a single positive amount', () => {
      const result = service.validatePositiveAmounts([100]);
      expect(result.isValid).toBe(true);
    });

    it('validatePositiveAmounts fails for a negative amount', () => {
      const result = service.validatePositiveAmounts([-50]);
      expect(result.isValid).toBe(false);
      expect(result.code).toBe('NEGATIVE_AMOUNT');
    });

    it('validatePositiveAmounts fails for a zero amount', () => {
      const result = service.validatePositiveAmounts([0]);
      expect(result.isValid).toBe(false);
      expect(result.code).toBe('ZERO_AMOUNT');
    });
  });

  // ProcessingRequest entity - lifecycle for single payment
  describe('ProcessingRequest entity - single payment lifecycle', () => {
    it('starts in PROCESSING status', () => {
      const req = ProcessingRequest.create('req-001', { total: 100 });
      expect(req.status).toBe('PROCESSING');
    });

    it('transitions to COMPLETED after markCompleted', () => {
      const req = ProcessingRequest.create('req-001', { total: 100 });
      req.markCompleted({ success: true });
      expect(req.status).toBe('COMPLETED');
    });

    it('transitions to FAILED after markFailed', () => {
      const req = ProcessingRequest.create('req-001', { total: 100 });
      req.markFailed('Validation error');
      expect(req.status).toBe('FAILED');
      expect(req.error).toBe('Validation error');
    });

    it('throws when trying to markCompleted a non-PROCESSING request', () => {
      const req = ProcessingRequest.create('req-001', { total: 100 });
      req.markCompleted({ success: true });
      expect(() => req.markCompleted({ success: true })).toThrow();
    });

    it('stores the result payload on completion', () => {
      const req = ProcessingRequest.create('req-001', { total: 100 });
      const response: SplitPaymentResponse = {
        success: true,
        receiptNumber: 'SPL-001',
        orderPayments: [],
        financialRecords: [],
      };
      req.markCompleted(response);
      expect(req.result).toEqual(response);
    });
  });
});

