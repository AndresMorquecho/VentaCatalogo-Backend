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

export default router;
