
import { Router } from 'express';
import { PaymentController } from './PaymentController';
import { SplitPaymentController } from './SplitPaymentController';
import { RegisterOrderPaymentUseCase } from '../application/RegisterOrderPayment.usecase';
import { ProcessSplitPaymentUseCase } from '../application/ProcessSplitPayment.usecase';
import { PrismaOrderRepository } from '../../orders/infrastructure/PrismaOrderRepository';
import { PrismaFinancialRecordRepository } from '../../financial/infrastructure/PrismaFinancialRecordRepository';
import { PrismaBankAccountRepository } from '../../financial/infrastructure/PrismaBankAccountRepository';
import { PrismaProcessingRequestRepository } from './PrismaProcessingRequestRepository';
import { PaymentValidationService } from '../domain/PaymentValidationService';
import { authenticate, requirePermission } from '../../../middleware/auth';

const router = Router();

// Repositories
const orderRepository = new PrismaOrderRepository();
const financialRepository = new PrismaFinancialRecordRepository();
const bankAccountRepository = new PrismaBankAccountRepository();
const processingRequestRepository = new PrismaProcessingRequestRepository();

// Services
const paymentValidationService = new PaymentValidationService();

// Use Cases
const registerOrderPaymentUseCase = new RegisterOrderPaymentUseCase(
    orderRepository,
    financialRepository,
    bankAccountRepository
);

const processSplitPaymentUseCase = new ProcessSplitPaymentUseCase(
    processingRequestRepository,
    paymentValidationService
);

// Controllers
const paymentController = new PaymentController(registerOrderPaymentUseCase);
const splitPaymentController = new SplitPaymentController(processSplitPaymentUseCase);

// Routes - existing
router.post('/', authenticate, requirePermission('payments.create'), paymentController.registerPayment);
router.put('/:paymentId', authenticate, requirePermission('payments.create'), paymentController.updatePayment);
router.delete('/:paymentId', authenticate, requirePermission('payments.delete'), paymentController.deletePayment);

// Routes - split payment
router.post('/split', authenticate, requirePermission('payments.create'), splitPaymentController.processSplitPayment);

export default router;
