
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { WalletController } from '../features/wallet/infrastructure/WalletController';
import { CreateWalletRechargeUseCase } from '../features/wallet/application/CreateWalletRecharge.usecase';
import { ValidateWalletRechargesUseCase } from '../features/wallet/application/ValidateWalletRecharges.usecase';
import { InstantWalletRechargeUseCase } from '../features/wallet/application/InstantWalletRecharge.usecase';
import { PrismaFinancialRecordRepository } from '../features/financial/infrastructure/PrismaFinancialRecordRepository';

const router = Router();

// Dependencies
const financialRepository = new PrismaFinancialRecordRepository();
const createUseCase = new CreateWalletRechargeUseCase(financialRepository);
const validateUseCase = new ValidateWalletRechargesUseCase(financialRepository);
const instantRechargeUseCase = new InstantWalletRechargeUseCase(financialRepository);
const controller = new WalletController(createUseCase, validateUseCase, instantRechargeUseCase);

// Routes
router.post('/recharges', authenticate, (req, res) => controller.createRecharge(req, res));
router.post('/recharges/instant', authenticate, (req, res) => controller.instantRecharge(req, res));
router.get('/recharges/pending', authenticate, (req, res) => controller.getPendingRecharges(req, res));
router.post('/recharges/validate', authenticate, (req, res) => controller.validateRecharges(req, res));
router.post('/recharge/:id/reject', authenticate, (req, res) => controller.rejectRecharge(req, res));
router.get('/recharges/history', authenticate, (req, res) => controller.getHistory(req, res));
router.get('/client/:clientId/history', authenticate, (req, res) => controller.getClientWalletHistory(req, res));

export default router;
