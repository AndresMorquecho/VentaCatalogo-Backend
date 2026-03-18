/**
 * Portfolio Recovery Analysis - Controller
 * 
 * Handles HTTP requests for portfolio recovery analytics endpoints.
 * Parses query parameters, validates inputs, and delegates to use cases.
 */

import { Request, Response } from 'express';
import { GetBrandRecoveryMetrics } from '../application/GetBrandRecoveryMetrics.usecase';
import { RecoveryFilters } from '../domain/RecoveryFilters.types';

/**
 * Controller for portfolio recovery analytics endpoints
 * 
 * Requirements: 1.1, 10.1, 10.5
 */
export class PortfolioRecoveryController {
  constructor(
    private getBrandRecoveryMetricsUseCase: GetBrandRecoveryMetrics,
    private repository: any // Agregamos el repositorio para acceder a getRecoveryTrends
  ) {}

  /**
   * GET /api/portfolio/brands
   * 
   * Get brand-level recovery metrics with filters and pagination
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
   */
  getBrandMetrics = async (req: Request, res: Response) => {
    try {
      // Parse filters from query params
      const filters: RecoveryFilters = this.parseFilters(req.query);

      // Parse pagination
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = Math.min(
        req.query.pageSize ? parseInt(req.query.pageSize as string) : 50,
        50 // Max page size
      );

      const pagination = { page, pageSize };

      // Log request
      console.log('[PortfolioRecoveryController] GET /api/portfolio/brands', {
        filters,
        pagination,
      });

      // Execute use case
      const startTime = Date.now();
      const result = await this.getBrandRecoveryMetricsUseCase.execute(filters, pagination);
      const duration = Date.now() - startTime;

      // Log response
      console.log('[PortfolioRecoveryController] Brand metrics retrieved', {
        duration: `${duration}ms`,
        itemCount: result.items.length,
        totalItems: result.pagination.totalItems,
      });

      // Return response
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[PortfolioRecoveryController] Error getting brand metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Determine if error is retryable
      const isRetryable = this.isRetryableError(error);
      const errorMessage = error instanceof Error ? error.message : 'Error al obtener métricas de marcas';

      // Return error with retryable flag
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: errorMessage,
          retryable: isRetryable,
        },
      });
    }
  };

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
   */
  getRecoveryTrends = async (req: Request, res: Response) => {
    try {
      // Parse groupBy parameter
      const groupBy = (req.query.groupBy as string)?.toUpperCase();
      if (!groupBy || !['DAY', 'WEEK', 'MONTH'].includes(groupBy)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PARAMETER',
            message: 'groupBy parameter is required and must be DAY, WEEK, or MONTH',
            retryable: false,
          },
        });
      }

      // Parse filters
      const filters: RecoveryFilters = this.parseFilters(req.query);

      console.log('[PortfolioRecoveryController] GET /api/portfolio/trends', {
        groupBy,
        filters,
      });

      // Execute query
      const startTime = Date.now();
      const result = await this.repository.getRecoveryTrends(filters, groupBy as any);
      const duration = Date.now() - startTime;

      console.log('[PortfolioRecoveryController] Trends retrieved', {
        duration: `${duration}ms`,
        periodCount: result.length,
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[PortfolioRecoveryController] Error getting trends', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      const isRetryable = this.isRetryableError(error);
      const errorMessage = error instanceof Error ? error.message : 'Error al obtener tendencias';

      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: errorMessage,
          retryable: isRetryable,
        },
      });
    }
  };

  /**
   * GET /api/portfolio/brands/list
   * 
   * Get list of all brands with orders in warehouse
   * Used for filter dropdowns
   */
  getBrandsList = async (req: Request, res: Response) => {
    try {
      console.log('[PortfolioRecoveryController] GET /api/portfolio/brands/list');

      const startTime = Date.now();
      const result = await this.repository.getBrandsList();
      const duration = Date.now() - startTime;

      console.log('[PortfolioRecoveryController] Brands list retrieved', {
        duration: `${duration}ms`,
        brandCount: result.length,
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[PortfolioRecoveryController] Error getting brands list', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      const isRetryable = this.isRetryableError(error);
      const errorMessage = error instanceof Error ? error.message : 'Error al obtener lista de marcas';

      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: errorMessage,
          retryable: isRetryable,
        },
      });
    }
  };

  /**
   * Parse recovery filters from query parameters
   */
  private parseFilters(query: any): RecoveryFilters {
    const filters: RecoveryFilters = {};

    // Date range
    if (query.dateFrom) {
      try {
        filters.dateFrom = new Date(query.dateFrom as string);
      } catch (error) {
        throw new Error('Invalid dateFrom format. Use ISO date string.');
      }
    }

    if (query.dateTo) {
      try {
        filters.dateTo = new Date(query.dateTo as string);
      } catch (error) {
        throw new Error('Invalid dateTo format. Use ISO date string.');
      }
    }

    // Brand IDs
    if (query.brandIds) {
      const brandIdsStr = query.brandIds as string;
      filters.brandIds = brandIdsStr.split(',').map((id) => id.trim()).filter(Boolean);
    }

    // Brand name (search)
    if (query.brandName) {
      filters.brandName = (query.brandName as string).trim();
    }

    // Client IDs
    if (query.clientIds) {
      const clientIdsStr = query.clientIds as string;
      filters.clientIds = clientIdsStr.split(',').map((id) => id.trim()).filter(Boolean);
    }

    // Recovery status
    if (query.recoveryStatus) {
      const status = (query.recoveryStatus as string).toUpperCase();
      if (['HEALTHY', 'WARNING', 'CRITICAL', 'ALL'].includes(status)) {
        filters.recoveryStatus = status as any;
      } else {
        throw new Error('Invalid recoveryStatus. Must be HEALTHY, WARNING, CRITICAL, or ALL.');
      }
    }

    // Min days in warehouse
    if (query.minDaysInWarehouse) {
      const days = parseInt(query.minDaysInWarehouse as string);
      if (isNaN(days) || days < 0) {
        throw new Error('Invalid minDaysInWarehouse. Must be a non-negative number.');
      }
      filters.minDaysInWarehouse = days;
    }

    // Min amount
    if (query.minAmount) {
      const amount = parseFloat(query.minAmount as string);
      if (isNaN(amount) || amount < 0) {
        throw new Error('Invalid minAmount. Must be a non-negative number.');
      }
      filters.minAmount = amount;
    }

    return filters;
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    // Database connection errors are retryable
    if (error.message?.includes('connection') || error.message?.includes('timeout')) {
      return true;
    }

    // Validation errors are not retryable
    if (error.message?.includes('Invalid')) {
      return false;
    }

    // Default to retryable for unknown errors
    return true;
  }
}
