/**
 * Portfolio Recovery Analysis - Filter and Pagination Types
 * 
 * Defines types for filtering, pagination, and query results.
 * These types are used to construct queries and return paginated results.
 */

import { RecoveryStatus } from './RecoveryMetrics.types';

// ============================================================================
// FILTER TYPES
// ============================================================================

/**
 * Global filters for portfolio recovery queries
 * All filters are optional and can be combined
 */
export interface RecoveryFilters {
  /**
   * Filter by date range - start date (inclusive)
   */
  dateFrom?: Date;

  /**
   * Filter by date range - end date (inclusive)
   */
  dateTo?: Date;

  /**
   * Filter by specific brand IDs
   */
  brandIds?: string[];

  /**
   * Filter by specific client IDs
   */
  clientIds?: string[];

  /**
   * Filter by recovery status classification
   * 'ALL' means no status filter applied
   */
  recoveryStatus?: RecoveryStatus | 'ALL';

  /**
   * Filter by minimum days in warehouse
   * Only include orders with at least this many days in warehouse
   */
  minDaysInWarehouse?: number;

  /**
   * Filter by minimum amount
   * Only include orders with total amount >= this value
   */
  minAmount?: number;
}

/**
 * Validation result for filters
 */
export interface FilterValidationResult {
  isValid: boolean;
  errors: string[];
}

// ============================================================================
// PAGINATION TYPES
// ============================================================================

/**
 * Pagination parameters for queries
 */
export interface Pagination {
  /**
   * Current page number (1-indexed)
   */
  page: number;

  /**
   * Number of items per page
   * Must be between 10 and 50 (enforced by validation)
   */
  pageSize: number;
}

/**
 * Metadata about pagination state
 */
export interface PaginationMeta {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Generic paginated result wrapper
 */
export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates recovery filters
 * @param filters - Filters to validate
 * @returns Validation result with errors if any
 */
export function validateRecoveryFilters(filters: RecoveryFilters): FilterValidationResult {
  const errors: string[] = [];

  // Validate date range
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    errors.push('La fecha inicial debe ser anterior a la fecha final');
  }

  // Validate minimum amount
  if (filters.minAmount !== undefined && filters.minAmount < 0) {
    errors.push('El monto mínimo no puede ser negativo');
  }

  // Validate minimum days in warehouse
  if (filters.minDaysInWarehouse !== undefined && filters.minDaysInWarehouse < 0) {
    errors.push('Los días mínimos no pueden ser negativos');
  }

  // Validate brand IDs array
  if (filters.brandIds !== undefined && !Array.isArray(filters.brandIds)) {
    errors.push('brandIds debe ser un array');
  }

  // Validate client IDs array
  if (filters.clientIds !== undefined && !Array.isArray(filters.clientIds)) {
    errors.push('clientIds debe ser un array');
  }

  // Validate recovery status
  if (filters.recoveryStatus !== undefined) {
    const validStatuses = ['HEALTHY', 'WARNING', 'CRITICAL', 'ALL'];
    if (!validStatuses.includes(filters.recoveryStatus)) {
      errors.push(`recoveryStatus debe ser uno de: ${validStatuses.join(', ')}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates pagination parameters
 * @param pagination - Pagination to validate
 * @returns Validation result with errors if any
 */
export function validatePagination(pagination: Pagination): FilterValidationResult {
  const errors: string[] = [];

  // Validate page number
  if (pagination.page < 1) {
    errors.push('El número de página debe ser mayor o igual a 1');
  }

  // Validate page size
  if (pagination.pageSize < 10 || pagination.pageSize > 50) {
    errors.push('El tamaño de página debe estar entre 10 y 50');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Creates pagination metadata from query results
 * @param totalItems - Total number of items matching the query
 * @param pagination - Pagination parameters used
 * @returns Pagination metadata
 */
export function createPaginationMeta(totalItems: number, pagination: Pagination): PaginationMeta {
  const totalPages = Math.ceil(totalItems / pagination.pageSize);
  
  return {
    currentPage: pagination.page,
    pageSize: pagination.pageSize,
    totalItems,
    totalPages,
    hasNextPage: pagination.page < totalPages,
    hasPreviousPage: pagination.page > 1,
  };
}

/**
 * Calculates SQL OFFSET from pagination parameters
 * @param pagination - Pagination parameters
 * @returns OFFSET value for SQL query
 */
export function calculateOffset(pagination: Pagination): number {
  return (pagination.page - 1) * pagination.pageSize;
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

/**
 * Default pagination values
 */
export const DEFAULT_PAGINATION: Pagination = {
  page: 1,
  pageSize: 50,
};

/**
 * Default empty filters
 */
export const DEFAULT_FILTERS: RecoveryFilters = {
  recoveryStatus: 'ALL',
};
