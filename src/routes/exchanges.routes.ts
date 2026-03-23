import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { CreateExchangeUseCase } from '../features/orders/application/CreateExchange.usecase';
import { AddExchangeItemUseCase } from '../features/orders/application/AddExchangeItem.usecase';
import { UpdateExchangeItemUseCase } from '../features/orders/application/UpdateExchangeItem.usecase';
import { UpdateExchangeStatusUseCase } from '../features/orders/application/UpdateExchangeStatus.usecase';
import { ProcessExchangeFinancialUseCase } from '../features/orders/application/ProcessExchangeFinancial.usecase';
import { GetExchangesUseCase } from '../features/orders/application/GetExchanges.usecase';
import { GetExchangeDetailUseCase } from '../features/orders/application/GetExchangeDetail.usecase';

const router = Router();

const createExchange = new CreateExchangeUseCase();
const addExchangeItem = new AddExchangeItemUseCase();
const updateExchangeItem = new UpdateExchangeItemUseCase();
const updateExchangeStatus = new UpdateExchangeStatusUseCase();
const processExchangeFinancial = new ProcessExchangeFinancialUseCase();
const getExchanges = new GetExchangesUseCase();
const getExchangeDetail = new GetExchangeDetailUseCase();

// POST /api/exchanges — crear exchange
router.post('/', authenticate, requirePermission('exchanges.manage'), async (req, res, next): Promise<void> => {
  try {
    const data = await createExchange.execute(req.body);
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    if (error.message === 'Cliente no encontrado') {
      res.status(400).json({ success: false, error: { message: error.message } });
      return;
    }
    next(error);
  }
});

// GET /api/exchanges — listar exchanges
router.get('/', authenticate, requirePermission('exchanges.view'), async (req, res, next): Promise<void> => {
  try {
    const { clientId, status, dateFrom, dateTo, onlyExchanges } = req.query;
    const data = await getExchanges.execute({
      clientId: clientId as string | undefined,
      status: status as string | undefined,
      dateFrom: dateFrom as string | undefined,
      dateTo: dateTo as string | undefined,
      onlyExchanges: onlyExchanges === 'true',
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/exchanges/:id — detalle
router.get('/:id', authenticate, requirePermission('exchanges.view'), async (req, res, next): Promise<void> => {
  try {
    const data = await getExchangeDetail.execute(req.params.id);
    res.json({ success: true, data });
  } catch (error: any) {
    if (error.message === 'Cambio no encontrado') {
      res.status(404).json({ success: false, error: { message: error.message } });
      return;
    }
    next(error);
  }
});

// PATCH /api/exchanges/:id/status — cambiar estado
router.patch('/:id/status', authenticate, requirePermission('exchanges.manage'), async (req, res, next): Promise<void> => {
  try {
    const data = await updateExchangeStatus.execute({
      exchangeId: req.params.id,
      newStatus: req.body.newStatus,
    });
    res.json({ success: true, data });
  } catch (error: any) {
    if (error.message === 'Cambio no encontrado') {
      res.status(404).json({ success: false, error: { message: error.message } });
      return;
    }
    if (error.message === 'Transición de estado no válida') {
      res.status(400).json({ success: false, error: { message: error.message } });
      return;
    }
    next(error);
  }
});

// POST /api/exchanges/:id/items — agregar ítem
router.post('/:id/items', authenticate, requirePermission('exchanges.manage'), async (req, res, next): Promise<void> => {
  try {
    const data = await addExchangeItem.execute({
      exchangeId: req.params.id,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    const clientErrors = [
      'Cambio no encontrado',
      'Solo se pueden agregar ítems cuando el cambio está en estado RECEIVED_FROM_CLIENT',
      'Pedido no encontrado',
      'Solo se pueden crear cambios para pedidos en estado ENTREGADO',
      'El pedido ya está incluido en este cambio',
    ];
    if (clientErrors.includes(error.message)) {
      res.status(400).json({ success: false, error: { message: error.message } });
      return;
    }
    next(error);
  }
});

// PUT /api/exchanges/:id/items/:itemId — actualizar ítem
router.put('/:id/items/:itemId', authenticate, requirePermission('exchanges.manage'), async (req, res, next): Promise<void> => {
  try {
    const data = await updateExchangeItem.execute({
      exchangeId: req.params.id,
      itemId: req.params.itemId,
      newValue: req.body.newValue,
    });
    res.json({ success: true, data });
  } catch (error: any) {
    if (error.message === 'Cambio no encontrado' || error.message === 'Ítem no encontrado') {
      res.status(404).json({ success: false, error: { message: error.message } });
      return;
    }
    if (error.message === 'No se pueden modificar ítems cuando el cambio está enviado al proveedor') {
      res.status(400).json({ success: false, error: { message: error.message } });
      return;
    }
    next(error);
  }
});

// POST /api/exchanges/:id/process-financial — procesar financiero
router.post('/:id/process-financial', authenticate, requirePermission('exchanges.manage'), async (req: any, res, next): Promise<void> => {
  try {
    const data = await processExchangeFinancial.execute({
      exchangeId: req.params.id,
      itemId: req.body.itemId,
      creditDestination: req.body.creditDestination,
      createdBy: req.user?.id || 'system',
      bankAccountId: req.body.bankAccountId,
    });
    res.json({ success: true, data });
  } catch (error: any) {
    const clientErrors = [
      'Cambio no encontrado',
      'Ítem no encontrado',
      'El procesamiento financiero solo está disponible cuando el cambio ha sido recibido del proveedor',
      'El procesamiento financiero de este ítem ya fue ejecutado',
      'Se requiere una cuenta bancaria para registrar la devolución en efectivo',
    ];
    if (clientErrors.includes(error.message)) {
      const status = error.message === 'Cambio no encontrado' || error.message === 'Ítem no encontrado' ? 404 : 400;
      res.status(status).json({ success: false, error: { message: error.message } });
      return;
    }
    next(error);
  }
});

export default router;
