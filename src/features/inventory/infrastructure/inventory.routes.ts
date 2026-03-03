import { Router } from 'express';
import { InventoryController } from './InventoryController';
import { GetInventoryMovementsUseCase } from '../application/GetInventoryMovements.usecase';
import { authenticate, requirePermission } from '../../../middleware/auth';

const router = Router();

const getInventoryMovementsUseCase = new GetInventoryMovementsUseCase();
const inventoryController = new InventoryController(getInventoryMovementsUseCase);

router.get('/movements', authenticate, requirePermission('inventory.view'), inventoryController.getMovements);

export default router;
