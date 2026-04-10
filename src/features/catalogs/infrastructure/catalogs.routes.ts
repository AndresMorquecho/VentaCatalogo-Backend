import { Router } from 'express';
import { CatalogController } from './CatalogController';
import { authenticate, requirePermission } from '../../../middleware/auth';

const router = Router();
const controller = new CatalogController();

// Inventario
router.post('/inventory', authenticate, requirePermission('catalogs.register'), controller.createInventory.bind(controller));
router.get('/inventory', authenticate, requirePermission('catalogs.view'), controller.getInventory.bind(controller));

// Entregas
router.post('/deliveries/validate', authenticate, requirePermission('catalogs.deliver'), controller.validateBehavior.bind(controller));
router.post('/deliveries', authenticate, requirePermission('catalogs.deliver'), controller.createDelivery.bind(controller));
router.get('/deliveries', authenticate, requirePermission('catalogs.view'), controller.getDeliveries.bind(controller));

export default router;
