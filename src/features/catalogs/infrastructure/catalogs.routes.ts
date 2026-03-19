import { Router } from 'express';
import { CatalogController } from './CatalogController';
import { authenticate } from '../../../middleware/auth';

const router = Router();
const controller = new CatalogController();

// Inventario
router.post('/inventory', authenticate, controller.createInventory.bind(controller));
router.get('/inventory', authenticate, controller.getInventory.bind(controller));

// Entregas
router.post('/deliveries/validate', authenticate, controller.validateBehavior.bind(controller));
router.post('/deliveries', authenticate, controller.createDelivery.bind(controller));
router.get('/deliveries', authenticate, controller.getDeliveries.bind(controller));

export default router;
