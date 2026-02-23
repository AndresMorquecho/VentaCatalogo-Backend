import { Router } from 'express';
import { OrderController } from './OrderController';
import { CreateOrderUseCase } from '../application/CreateOrder.usecase';
import { GetOrdersUseCase } from '../application/GetOrders.usecase';
import { ReceiveOrderUseCase } from '../application/ReceiveOrder.usecase';
import { DeliverOrderUseCase } from '../application/DeliverOrder.usecase';
import { PrismaOrderRepository } from './PrismaOrderRepository';
import { PrismaFinancialRecordRepository } from '../../financial/infrastructure/PrismaFinancialRecordRepository';
import { PrismaBankAccountRepository } from '../../financial/infrastructure/PrismaBankAccountRepository';
import { authenticate } from '../../../middleware/auth';

const router = Router();

// Repositories
const orderRepository = new PrismaOrderRepository();
const financialRepository = new PrismaFinancialRecordRepository();
const bankAccountRepository = new PrismaBankAccountRepository();

// Use Cases
const createOrderUseCase = new CreateOrderUseCase(orderRepository, financialRepository, bankAccountRepository);
const getOrdersUseCase = new GetOrdersUseCase(orderRepository);
const receiveOrderUseCase = new ReceiveOrderUseCase(orderRepository, financialRepository);
const deliverOrderUseCase = new DeliverOrderUseCase(orderRepository, financialRepository);

// Controller
const orderController = new OrderController(
  createOrderUseCase,
  getOrdersUseCase,
  orderRepository,
  receiveOrderUseCase,
  deliverOrderUseCase
);

// Routes
router.get('/', authenticate, orderController.getAll);
router.get('/generate-receipt-number', authenticate, orderController.generateReceiptNumber);
router.get('/check-receipt/:receiptNumber', authenticate, orderController.checkReceiptExists);
router.post('/', authenticate, orderController.create);
router.post('/batch-reception', authenticate, orderController.batchReception);
router.post('/batch-reception-simple', authenticate, orderController.batchReceptionSimple);
router.post('/:id/receive', authenticate, orderController.receiveOrder);
router.post('/:id/deliver', authenticate, orderController.deliverOrder);
router.put('/:id', authenticate, orderController.update);
router.delete('/:id', authenticate, orderController.deleteOrder);

export default router;
