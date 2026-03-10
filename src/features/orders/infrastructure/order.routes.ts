import { Router } from 'express';
import { OrderController } from './OrderController';
import { CreateOrderUseCase } from '../application/CreateOrder.usecase';
import { BatchCreateOrderUseCase } from '../application/BatchCreateOrder.usecase';
import { GetOrdersUseCase } from '../application/GetOrders.usecase';
import { ReceiveOrderUseCase } from '../application/ReceiveOrder.usecase';
import { DeliverOrderUseCase } from '../application/DeliverOrder.usecase';
import { DeleteOrderUseCase } from '../application/DeleteOrder.usecase';
import { BatchUpdateOrdersUseCase } from '../application/BatchUpdateOrders.usecase';
import { PrismaOrderRepository } from './PrismaOrderRepository';
import { PrismaFinancialRecordRepository } from '../../financial/infrastructure/PrismaFinancialRecordRepository';
import { PrismaBankAccountRepository } from '../../financial/infrastructure/PrismaBankAccountRepository';
import { authenticate, requirePermission } from '../../../middleware/auth';

const router = Router();

// Repositories
const orderRepository = new PrismaOrderRepository();
const financialRepository = new PrismaFinancialRecordRepository();
const bankAccountRepository = new PrismaBankAccountRepository();

// Use Cases
const createOrderUseCase = new CreateOrderUseCase(orderRepository, financialRepository, bankAccountRepository);
const batchCreateOrderUseCase = new BatchCreateOrderUseCase(orderRepository);
const getOrdersUseCase = new GetOrdersUseCase(orderRepository);
const receiveOrderUseCase = new ReceiveOrderUseCase(orderRepository, financialRepository);
const deliverOrderUseCase = new DeliverOrderUseCase(orderRepository, financialRepository);
const deleteOrderUseCase = new DeleteOrderUseCase();
const batchUpdateOrdersUseCase = new BatchUpdateOrdersUseCase();

// Controller
console.log(`[OrderRoutes] Initializing OrderController with BatchUpdateOrdersUseCase: ${!!batchUpdateOrdersUseCase}`);
const orderController = new OrderController(
  createOrderUseCase,
  getOrdersUseCase,
  orderRepository,
  receiveOrderUseCase,
  deliverOrderUseCase,
  deleteOrderUseCase,
  batchCreateOrderUseCase,
  batchUpdateOrdersUseCase
);

// Routes — READ
router.get('/receipt/:receiptNumber', authenticate, requirePermission('orders.view'), orderController.getByReceiptNumber);
router.get('/generate-receipt-number', authenticate, requirePermission('orders.create'), orderController.generateReceiptNumber);
router.get('/check-receipt/:receiptNumber', authenticate, requirePermission('orders.view'), orderController.checkReceiptExists);
router.get('/:id', authenticate, requirePermission('orders.view'), orderController.getById);
router.get('/', authenticate, requirePermission('orders.view'), orderController.getAll);

// Routes — WRITE (granular RBAC)
router.put('/receipt/:receiptNumber/bulk-update', authenticate, requirePermission('orders.edit'), orderController.batchUpdate);
router.post('/batch', authenticate, requirePermission('orders.create'), orderController.batchCreate);
router.post('/batch-reception', authenticate, requirePermission('reception.confirm'), orderController.batchReception);
router.post('/batch-reception-simple', authenticate, requirePermission('reception.confirm'), orderController.batchReceptionSimple);
router.post('/', authenticate, requirePermission('orders.create'), orderController.create);
router.post('/:id/receive', authenticate, requirePermission('reception.confirm'), orderController.receiveOrder);
router.post('/:id/reverse-reception', authenticate, requirePermission('reception.confirm'), orderController.reverseReception);
router.post('/:id/deliver', authenticate, requirePermission('delivery.confirm'), orderController.deliverOrder);
router.put('/:id', authenticate, requirePermission('orders.edit'), orderController.update);
router.delete('/:id', authenticate, requirePermission('orders.delete'), orderController.deleteOrder);

export default router;
