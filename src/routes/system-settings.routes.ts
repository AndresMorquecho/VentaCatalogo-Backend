import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { SystemSettingsController } from '../features/system-settings/infrastructure/SystemSettingsController';

const router = Router();
const controller = new SystemSettingsController();

// Authentication middleware applied globally to settings
router.use(authenticate);

// Settings
router.get('/', (req, res) => controller.getSettings(req, res));
router.patch('/:key', (req, res) => controller.updateSetting(req, res));

// Note Templates
router.get('/notes', (req, res) => controller.getNoteTemplates(req, res));
router.get('/notes/default', (req, res) => controller.getDefaultNote(req, res));
router.post('/notes', (req, res) => controller.upsertNote(req, res));
router.delete('/notes/:id', (req, res) => controller.deleteNote(req, res));

// Order Types
router.get('/order-types', (req, res) => controller.getOrderTypes(req, res));
router.post('/order-types', (req, res) => controller.upsertOrderType(req, res));
router.delete('/order-types/:id', (req, res) => controller.deleteOrderType(req, res));

// Sales Channels
router.get('/sales-channels', (req, res) => controller.getSalesChannels(req, res));
router.post('/sales-channels', (req, res) => controller.upsertSalesChannel(req, res));
router.delete('/sales-channels/:id', (req, res) => controller.deleteSalesChannel(req, res));

export default router;
