/**
 * Portfolio Recovery Analysis - Routes
 * 
 * Defines HTTP routes for portfolio recovery analytics endpoints.
 * All routes require authentication.
 */

import { Router } from 'express';
import { prisma } from '../../../lib/prisma';
import { authenticate } from '../../../middleware/auth';
import { PortfolioRecoveryController } from './PortfolioRecoveryController';
import { PrismaPortfolioRecoveryRepository } from './PrismaPortfolioRecoveryRepository';
import { GetBrandRecoveryMetrics } from '../application/GetBrandRecoveryMetrics.usecase';
import { CacheManager } from './CacheManager';

const router = Router();

// Initialize dependencies
// Use singleton prisma
const repoPrisma = prisma;
const repository = new PrismaPortfolioRecoveryRepository(repoPrisma);

// Initialize cache manager with 60 second TTL (configurable via env)
const cacheTTL = process.env.PORTFOLIO_CACHE_TTL 
  ? parseInt(process.env.PORTFOLIO_CACHE_TTL) 
  : 60;
const cacheManager = new CacheManager({ ttlSeconds: cacheTTL });

// Initialize use cases
const getBrandRecoveryMetricsUseCase = new GetBrandRecoveryMetrics(
  repository,
  cacheManager
);

// Initialize controller
const controller = new PortfolioRecoveryController(
  getBrandRecoveryMetricsUseCase,
  repository // Pasar el repositorio para acceder a getRecoveryTrends
);

/**
 * GET /api/portfolio/brands/list
 * 
 * Get list of all brands with orders in warehouse (for filter dropdowns)
 * 
 * Response:
 * {
 *   success: true,
 *   data: Array<{ id: string, name: string }>
 * }
 */
router.get('/brands/list', authenticate, controller.getBrandsList);

/**
 * GET /api/portfolio/brands
 * 
 * Get brand-level recovery metrics
 * 
 * Query Parameters:
 * - dateFrom: ISO date string (optional)
 * - dateTo: ISO date string (optional)
 * - brandIds: Comma-separated brand IDs (optional)
 * - clientIds: Comma-separated client IDs (optional)
 * - recoveryStatus: HEALTHY | WARNING | CRITICAL | ALL (optional)
 * - minDaysInWarehouse: Number (optional)
 * - minAmount: Number (optional)
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 50, max: 50)
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     items: BrandRecoveryMetrics[],
 *     pagination: PaginationMeta
 *   }
 * }
 * 
 * Requirements: 8.1
 */
router.get('/brands', authenticate, controller.getBrandMetrics);

/**
 * GET /api/portfolio/clients
 * 
 * Get client-level recovery metrics (to be implemented in Phase 4)
 */
router.get('/clients', authenticate, (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Client metrics endpoint not yet implemented. Coming in Phase 4.',
  });
});

/**
 * GET /api/portfolio/trends
 * 
 * Get recovery trends over time
 * 
 * Query Parameters:
 * - groupBy: DAY | WEEK | MONTH (required)
 * - dateFrom: ISO date string (optional)
 * - dateTo: ISO date string (optional)
 * - brandIds: Comma-separated brand IDs (optional)
 * 
 * Response:
 * {
 *   success: true,
 *   data: RecoveryTrend[]
 * }
 */
router.get('/trends', authenticate, controller.getRecoveryTrends);

/**
 * GET /api/portfolio/alerts
 * 
 * Get recovery alerts (to be implemented in Phase 4)
 */
router.get('/alerts', authenticate, (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Alerts endpoint not yet implemented. Coming in Phase 4.',
  });
});

/**
 * PATCH /api/portfolio/alerts/:id
 * 
 * Update alert status (to be implemented in Phase 4)
 */
router.patch('/alerts/:id', authenticate, (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Alert update endpoint not yet implemented. Coming in Phase 4.',
  });
});

export default router;
