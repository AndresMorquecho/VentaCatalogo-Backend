import { Router } from 'express';
import { DashboardController } from './DashboardController';
import { GetDashboardSummaryUseCase } from '../application/GetDashboardSummary.usecase';
import { authenticate, requirePermission } from '../../../middleware/auth';

const router = Router();

const getDashboardSummaryUseCase = new GetDashboardSummaryUseCase();
const dashboardController = new DashboardController(getDashboardSummaryUseCase);

// TASK-3.1: requirePermission added — prevents low-privilege users from seeing financial data
router.get('/summary', authenticate, requirePermission('dashboard.view'), dashboardController.getSummary);

export default router;
