/**
 * Portfolio Recovery Analysis - Get Brand Recovery Metrics Use Case
 * 
 * Retrieves brand-level recovery metrics with caching support.
 * Implements cache-aside pattern: check cache → query database → update cache.
 */

import { IPortfolioRecoveryRepository } from '../domain/IPortfolioRecoveryRepository';
import { CacheManager, buildCacheKey } from '../infrastructure/CacheManager';
import {
  BrandRecoveryMetrics,
} from '../domain/RecoveryMetrics.types';
import {
  RecoveryFilters,
  Pagination,
  PaginatedResult,
  validateRecoveryFilters,
  validatePagination,
} from '../domain/RecoveryFilters.types';

/**
 * Use case for retrieving brand recovery metrics
 * 
 * Flow:
 * 1. Validate input filters and pagination
 * 2. Generate cache key from filters
 * 3. Check cache for existing result
 * 4. If cache miss, query repository
 * 5. Store result in cache
 * 6. Return result
 * 
 * Requirements: 1.1, 1.5, 6.3
 */
export class GetBrandRecoveryMetrics {
  constructor(
    private repository: IPortfolioRecoveryRepository,
    private cacheManager: CacheManager
  ) {}

  /**
   * Execute the use case
   * 
   * @param filters - Recovery filters to apply
   * @param pagination - Pagination parameters
   * @returns Paginated brand recovery metrics
   * @throws Error if validation fails
   */
  async execute(
    filters: RecoveryFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<BrandRecoveryMetrics>> {
    // Validate inputs
    const filterValidation = validateRecoveryFilters(filters);
    if (!filterValidation.isValid) {
      throw new Error(`Invalid filters: ${filterValidation.errors.join(', ')}`);
    }

    const paginationValidation = validatePagination(pagination);
    if (!paginationValidation.isValid) {
      throw new Error(`Invalid pagination: ${paginationValidation.errors.join(', ')}`);
    }

    // Generate cache key
    const cacheKey = buildCacheKey('brand-metrics', filters, pagination);

    // Check cache
    const cached = await this.cacheManager.get<PaginatedResult<BrandRecoveryMetrics>>(cacheKey);
    if (cached) {
      console.log('[GetBrandRecoveryMetrics] Returning cached result');
      return cached;
    }

    // Cache miss - query repository
    console.log('[GetBrandRecoveryMetrics] Cache miss, querying repository');
    const startTime = Date.now();
    
    const result = await this.repository.getBrandMetrics(filters, pagination);
    
    const duration = Date.now() - startTime;
    console.log('[GetBrandRecoveryMetrics] Repository query completed', {
      duration: `${duration}ms`,
      itemCount: result.items.length,
      totalItems: result.pagination.totalItems,
    });

    // Store in cache
    await this.cacheManager.set(cacheKey, result, this.cacheManager.getTTL());

    return result;
  }

  /**
   * Invalidate cache for brand metrics
   * 
   * Useful when data changes (e.g., new payment recorded)
   */
  async invalidateCache(): Promise<void> {
    await this.cacheManager.invalidate('brand-metrics');
    console.log('[GetBrandRecoveryMetrics] Cache invalidated');
  }
}
