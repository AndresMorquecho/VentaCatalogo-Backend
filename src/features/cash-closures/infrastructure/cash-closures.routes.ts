import { Router } from 'express';
import { authenticate, authorize, requirePermission } from '../../../middleware/auth';
import { CashClosureController } from './CashClosureController';
import { GetCashClosuresUseCase } from '../application/GetCashClosures.usecase';
import { CreateCashClosureUseCase } from '../application/CreateCashClosure.usecase';
import { GetCashClosurePreviewUseCase } from '../application/GetCashClosurePreview.usecase';
import { PrismaCashClosureRepository } from './PrismaCashClosureRepository';

const router = Router();

// Dependencies
const cashClosureRepository = new PrismaCashClosureRepository();
const getCashClosuresUseCase = new GetCashClosuresUseCase(cashClosureRepository);
const createCashClosureUseCase = new CreateCashClosureUseCase(cashClosureRepository);
const getCashClosurePreviewUseCase = new GetCashClosurePreviewUseCase(cashClosureRepository);

const controller = new CashClosureController(
    getCashClosuresUseCase,
    createCashClosureUseCase,
    getCashClosurePreviewUseCase,
    cashClosureRepository
);

// Routes
router.get('/', authenticate, requirePermission('cash_closure.view'), (req: any, res, next) => controller.getAll(req, res, next));
router.get('/preview', authenticate, requirePermission('cash_closure.view'), (req: any, res, next) => controller.getPreview(req, res, next));
router.get('/:id', authenticate, requirePermission('cash_closure.view'), (req: any, res, next) => controller.getById(req, res, next));
router.post('/', authenticate, requirePermission('cash_closure.close'), (req: any, res, next) => controller.create(req, res, next));
router.delete('/:id', authenticate, authorize('ADMIN'), (req: any, res, next) => controller.delete(req, res, next));

export default router;
