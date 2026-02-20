import { Router } from 'express';
import { OrderController } from './OrderController';
import { CreateOrderUseCase } from '../application/CreateOrder.usecase';
import { GetOrdersUseCase } from '../application/GetOrders.usecase';
import { PrismaOrderRepository } from './PrismaOrderRepository';
import { PrismaFinancialRecordRepository } from '../../financial/infrastructure/PrismaFinancialRecordRepository';
import { authenticate } from '../../../middleware/auth';

const router = Router();

// Repositories
const orderRepository = new PrismaOrderRepository();
const financialRepository = new PrismaFinancialRecordRepository();

// Use Cases
const createOrderUseCase = new CreateOrderUseCase(orderRepository, financialRepository);
const getOrdersUseCase = new GetOrdersUseCase(orderRepository);

// Controller
const orderController = new OrderController(createOrderUseCase, getOrdersUseCase);

// Routes
router.get('/', authenticate, orderController.getAll);
router.post('/', authenticate, orderController.create);

export default router;
