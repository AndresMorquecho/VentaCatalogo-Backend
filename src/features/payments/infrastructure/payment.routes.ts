
import { Router } from 'express';
import { PaymentController } from './PaymentController';
import { RegisterOrderPaymentUseCase } from '../application/RegisterOrderPayment.usecase';
import { PrismaOrderRepository } from '../../orders/infrastructure/PrismaOrderRepository';
import { PrismaFinancialRecordRepository } from '../../financial/infrastructure/PrismaFinancialRecordRepository';
import { PrismaBankAccountRepository } from '../../financial/infrastructure/PrismaBankAccountRepository';
import { authenticate } from '../../../middleware/auth';

const router = Router();

// Repositories
const orderRepository = new PrismaOrderRepository();
const financialRepository = new PrismaFinancialRecordRepository();
const bankAccountRepository = new PrismaBankAccountRepository();

// Use Cases
const registerOrderPaymentUseCase = new RegisterOrderPaymentUseCase(
    orderRepository,
    financialRepository,
    bankAccountRepository
);

// Controller
const paymentController = new PaymentController(registerOrderPaymentUseCase);

// Routes
router.post('/', authenticate, paymentController.registerPayment);

export default router;
