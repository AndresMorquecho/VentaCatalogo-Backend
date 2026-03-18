/**
 * Portfolio Recovery Analysis - Repository Interface
 * 
 * Defines the contract for portfolio recovery data access.
 * Implementations should execute optimized SQL queries with aggregations.
 */

import {
  BrandRecoveryMetrics,
  ClientRecoveryMetrics,
  RecoveryTrend,
  RecoveryAlert,
  TrendGroupBy,
  AlertStatus,
} from './RecoveryMetrics.types';
import {
  RecoveryFilters,
  Pagination,
  PaginatedResult,
} from './RecoveryFilters.types';

/**
 * Repository interface for portfolio recovery analytics
 * 
 * All methods should:
 * - Execute aggregations in SQL (not application layer)
 * - Use database indexes for optimal performance
 * - Apply filters dynamically based on provided parameters
 * - Return paginated results where applicable
 */
export interface IPortfolioRecoveryRepository {
  /**
   * Get brand-level recovery metrics with aggregations
   * 
   * Calculates:
   * - Total amount in warehouse per brand
   * - Total recovered amount per brand
   * - Recovery rate percentage
   * - Average days in warehouse
   * - Recovery status classification
   * 
   * @param filters - Optional filters to apply
   * @param pagination - Pagination parameters
   * @returns Paginated brand recovery metrics
   * 
   * Requirements: 1.1, 1.5, 7.1, 7.2, 7.3, 7.4
   */
  getBrandMetrics(
    filters: RecoveryFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<BrandRecoveryMetrics>>;

  /**
   * Get client-level recovery metrics with aggregations
   * 
   * Calculates:
   * - Total amount in warehouse per client
   * - Total recovered amount per client
   * - Recovery rate percentage
   * - Brand breakdown for each client
   * - Payment history
   * - High-risk classification
   * 
   * @param filters - Optional filters to apply
   * @param pagination - Pagination parameters
   * @returns Paginated client recovery metrics
   * 
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6
   */
  getClientMetrics(
    filters: RecoveryFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<ClientRecoveryMetrics>>;

  /**
   * Get recovery trends over time with temporal aggregations
   * 
   * Calculates:
   * - Recovery metrics grouped by time period
   * - Trends for specified date range
   * - Supports daily, weekly, or monthly grouping
   * 
   * @param filters - Optional filters to apply
   * @param groupBy - Time period grouping (DAY, WEEK, MONTH)
   * @returns Array of recovery trends ordered by period
   * 
   * Requirements: 3.1, 3.5, 3.6
   */
  getRecoveryTrends(
    filters: RecoveryFilters,
    groupBy: TrendGroupBy
  ): Promise<RecoveryTrend[]>;

  /**
   * Get recovery alerts for critical situations
   * 
   * Generates alerts for:
   * - Brands with low recovery rate (<50%)
   * - Orders with excessive days in warehouse
   * - Clients with late payment patterns
   * 
   * @param filters - Optional filters to apply
   * @returns Array of alerts ordered by severity and date
   * 
   * Requirements: 4.1, 4.2, 4.3, 4.4
   */
  getAlerts(filters: RecoveryFilters): Promise<RecoveryAlert[]>;

  /**
   * Update alert status (mark as reviewed or resolved)
   * 
   * @param alertId - ID of the alert to update
   * @param status - New status (REVIEWED or RESOLVED)
   * @returns void
   * 
   * Requirements: 4.5
   */
  updateAlertStatus(alertId: string, status: AlertStatus): Promise<void>;

  /**
   * Get detailed order breakdown for a specific brand
   * 
   * @param brandId - Brand ID to get orders for
   * @param filters - Optional filters to apply
   * @param pagination - Pagination parameters
   * @returns Paginated order details
   * 
   * Requirements: 1.4
   */
  getBrandOrderDetails(
    brandId: string,
    filters: RecoveryFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<any>>;

  /**
   * Get detailed order and payment history for a specific client
   * 
   * @param clientId - Client ID to get history for
   * @param filters - Optional filters to apply
   * @param pagination - Pagination parameters
   * @returns Paginated order and payment history
   * 
   * Requirements: 2.5
   */
  getClientOrderHistory(
    clientId: string,
    filters: RecoveryFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<any>>;
}
