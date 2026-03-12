import { Router } from 'express';
import { OrderController } from './OrderController';
import { CreateOrderUseCase } from '../application/CreateOrder.usecase';
import { BatchCreateOrderUseCase } from '../application/BatchCreateOrder.usecase';
import { GetOrdersUseCase } from '../application/GetOrders.usecase';
import { ReceiveOrderUseCase } from '../application/ReceiveOrder.usecase';
import { DeliverOrderUseCase } from '../application/DeliverOrder.usecase';
import { DeleteOrderUseCase } from '../application/DeleteOrder.usecase';
import { BatchUpdateOrdersUseCase } from '../application/BatchUpdateOrders.usecase';
import { CreateReceptionBatchUseCase } from '../application/CreateReceptionBatch.usecase';
import { DeleteReceptionBatchUseCase } from '../application/DeleteReceptionBatch.usecase';
import { BatchDeliverOrdersUseCase } from '../application/BatchDeliverOrders.usecase';
import { PrismaOrderRepository } from './PrismaOrderRepository';
import { PrismaFinancialRecordRepository } from '../../financial/infrastructure/PrismaFinancialRecordRepository';
import { PrismaBankAccountRepository } from '../../financial/infrastructure/PrismaBankAccountRepository';
import { authenticate, requirePermission } from '../../../middleware/auth';
import { prisma } from '../../../lib/prisma';

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
const createReceptionBatchUseCase = new CreateReceptionBatchUseCase(receiveOrderUseCase);
const deleteReceptionBatchUseCase = new DeleteReceptionBatchUseCase();
const batchDeliverOrdersUseCase = new BatchDeliverOrdersUseCase();

// Controller
console.log(`[OrderRoutes] Initializing OrderController. BatchDeliverUsecase: ${!!batchDeliverOrdersUseCase}`);
const orderController = new OrderController(
  createOrderUseCase,
  getOrdersUseCase,
  orderRepository,
  receiveOrderUseCase,
  deliverOrderUseCase,
  deleteOrderUseCase,
  batchCreateOrderUseCase,
  batchUpdateOrdersUseCase,
  createReceptionBatchUseCase,
  deleteReceptionBatchUseCase,
  batchDeliverOrdersUseCase
);

// Routes — READ
// Receipt header endpoints (encabezado del recibo)
router.get('/receipt-header/:receiptNumber', authenticate, requirePermission('orders.view'), async (req, res) => {
  const receiptNumber = req.params.receiptNumber;
  const receipt = await (prisma as any).orderReceipt.findUnique({
    where: { receiptNumber },
  });
  if (!receipt) return res.status(404).json({ success: false, error: { message: 'Receipt not found' } });
  return res.json({ success: true, data: receipt });
});

router.put('/receipt-header/:receiptNumber', authenticate, requirePermission('orders.edit'), async (req: any, res) => {
  const receiptNumber = req.params.receiptNumber;
  const existing = await (prisma as any).orderReceipt.findUnique({ where: { receiptNumber } });
  if (!existing) return res.status(404).json({ success: false, error: { message: 'Receipt not found' } });

  // Validate cash closure: do not allow edits if receipt transactionDate is closed
  const lastClosure = await prisma.cashClosure.findFirst({ orderBy: { toDate: 'desc' } });
  if (lastClosure && existing.transactionDate <= lastClosure.toDate) {
    return res.status(400).json({ success: false, error: { message: 'No se puede editar: El periodo de caja ya está cerrado.' } });
  }

  const updated = await (prisma as any).orderReceipt.update({
    where: { receiptNumber },
    data: {
      salesChannel: req.body.sales_channel ?? req.body.salesChannel ?? undefined,
      paymentMethod: req.body.payment_method ?? req.body.paymentMethod ?? undefined,
      bankAccountId: req.body.bank_account_id ?? req.body.bankAccountId ?? undefined,
      transactionDate: req.body.transaction_date ? new Date(req.body.transaction_date) : undefined,
      transactionReference: req.body.transaction_reference ?? req.body.transactionReference ?? undefined,
      notes: req.body.notes ?? undefined,
      version: { increment: 1 }
    }
  });

  // Keep denormalized fields in orders in sync (fast bulk update)
  await prisma.order.updateMany({
    where: { receiptNumber },
    data: {
      salesChannel: updated.salesChannel,
      paymentMethod: updated.paymentMethod,
      bankAccountId: updated.bankAccountId,
      transactionDate: updated.transactionDate,
      notes: updated.notes ?? undefined,
      version: { increment: 1 }
    }
  });

  return res.json({ success: true, data: updated });
});

router.get('/receipt/:receiptNumber', authenticate, requirePermission('orders.view'), orderController.getByReceiptNumber);
router.get('/generate-receipt-number', authenticate, requirePermission('orders.create'), orderController.generateReceiptNumber);
router.get('/check-receipt/:receiptNumber', authenticate, requirePermission('orders.view'), orderController.checkReceiptExists);
router.get('/reception-batches', authenticate, requirePermission('reception.confirm'), orderController.getReceptionBatches);
router.delete('/reception-batches/:id', authenticate, requirePermission('reception.confirm'), orderController.deleteReceptionBatch);
router.get('/:id', authenticate, requirePermission('orders.view'), orderController.getById);
router.get('/', authenticate, requirePermission('orders.view'), orderController.getAll);

// Routes — WRITE (granular RBAC)
router.post('/batch-deliver', authenticate, requirePermission('delivery.confirm'), orderController.batchDeliver);
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
