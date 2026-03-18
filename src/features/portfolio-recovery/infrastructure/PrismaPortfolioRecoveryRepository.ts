/**
 * Portfolio Recovery Analysis - Prisma Repository Implementation
 * 
 * Implements portfolio recovery data access using Prisma ORM with optimized SQL queries.
 * All aggregations are performed in the database for optimal performance.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  BrandRecoveryMetrics,
  ClientRecoveryMetrics,
  RecoveryTrend,
  RecoveryAlert,
  TrendGroupBy,
  AlertStatus,
  getRecoveryStatus,
  calculateDaysInWarehouse,
} from '../domain/RecoveryMetrics.types';
import {
  RecoveryFilters,
  Pagination,
  PaginatedResult,
  createPaginationMeta,
  calculateOffset,
} from '../domain/RecoveryFilters.types';
import { IPortfolioRecoveryRepository } from '../domain/IPortfolioRecoveryRepository';

export class PrismaPortfolioRecoveryRepository implements IPortfolioRecoveryRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get brand-level recovery metrics with SQL aggregations
   * 
   * Uses CTEs for optimal query performance:
   * 1. warehouse_orders: Filter orders in warehouse with date/brand filters
   * 2. payments_by_order: Aggregate payments per order
   * 3. Final SELECT: Group by brand and calculate metrics
   */
  async getBrandMetrics(
    filters: RecoveryFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<BrandRecoveryMetrics>> {
    const offset = calculateOffset(pagination);
    const limit = pagination.pageSize;

    // Build dynamic WHERE conditions for filters
    const whereConditions: string[] = ["o.status IN ('RECIBIDO_EN_BODEGA', 'POR_RECIBIR')"];
    const params: any[] = [];
    let paramIndex = 1;

    // Date range filters
    if (filters.dateFrom) {
      whereConditions.push(`o.reception_date >= $${paramIndex}`);
      params.push(filters.dateFrom);
      paramIndex++;
    }

    if (filters.dateTo) {
      whereConditions.push(`o.reception_date <= $${paramIndex}`);
      params.push(filters.dateTo);
      paramIndex++;
    }

    // Brand filter
    if (filters.brandIds && filters.brandIds.length > 0) {
      whereConditions.push(`o.brand_id = ANY($${paramIndex}::text[])`);
      params.push(filters.brandIds);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Build HAVING clause for post-aggregation filters
    const havingConditions: string[] = [];

    // Recovery status filter
    if (filters.recoveryStatus && filters.recoveryStatus !== 'ALL') {
      if (filters.recoveryStatus === 'HEALTHY') {
        havingConditions.push('recovery_rate > 50');
      } else if (filters.recoveryStatus === 'WARNING') {
        havingConditions.push('recovery_rate >= 30 AND recovery_rate <= 50');
      } else if (filters.recoveryStatus === 'CRITICAL') {
        havingConditions.push('recovery_rate < 30');
      }
    }

    // Min days in warehouse filter
    if (filters.minDaysInWarehouse !== undefined) {
      havingConditions.push(`avg_days_in_warehouse >= ${filters.minDaysInWarehouse}`);
    }

    // Min amount filter
    if (filters.minAmount !== undefined) {
      havingConditions.push(`total_in_warehouse >= ${filters.minAmount}`);
    }

    const havingClause = havingConditions.length > 0 
      ? `HAVING ${havingConditions.join(' AND ')}` 
      : '';

    // Main query with CTEs
    const query = `
      WITH warehouse_orders AS (
        SELECT 
          o.brand_id,
          b.name as brand_name,
          o.id as order_id,
          o.total,
          o.reception_date,
          EXTRACT(DAY FROM (CURRENT_DATE - o.reception_date::timestamp))::integer as days_in_warehouse
        FROM orders o
        INNER JOIN brands b ON o.brand_id = b.id
        WHERE ${whereClause}
      ),
      payments_by_order AS (
        SELECT 
          op.order_id,
          COALESCE(SUM(op.amount), 0) as total_paid
        FROM order_payments op
        WHERE op.order_id IN (SELECT order_id FROM warehouse_orders)
        GROUP BY op.order_id
      ),
      brand_aggregates AS (
        SELECT 
          wo.brand_id,
          wo.brand_name,
          SUM(wo.total) as total_in_warehouse,
          COALESCE(SUM(p.total_paid), 0) as total_recovered,
          SUM(wo.total) - COALESCE(SUM(p.total_paid), 0) as total_outstanding,
          CASE 
            WHEN SUM(wo.total) > 0 
            THEN (COALESCE(SUM(p.total_paid), 0) / SUM(wo.total) * 100)
            ELSE 0 
          END as recovery_rate,
          COUNT(DISTINCT wo.order_id) as order_count,
          AVG(wo.days_in_warehouse) as avg_days_in_warehouse
        FROM warehouse_orders wo
        LEFT JOIN payments_by_order p ON wo.order_id = p.order_id
        GROUP BY wo.brand_id, wo.brand_name
        ${havingClause}
      )
      SELECT 
        brand_id,
        brand_name,
        total_in_warehouse,
        total_recovered,
        total_outstanding,
        recovery_rate,
        order_count,
        avg_days_in_warehouse,
        CASE
          WHEN recovery_rate > 50 THEN 'HEALTHY'
          WHEN recovery_rate >= 30 THEN 'WARNING'
          ELSE 'CRITICAL'
        END as recovery_status
      FROM brand_aggregates
      ORDER BY recovery_rate ASC, total_outstanding DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    // Execute query
    const results = await this.prisma.$queryRawUnsafe<any[]>(query, ...params);

    // Get total count for pagination
    const countQuery = `
      WITH warehouse_orders AS (
        SELECT 
          o.brand_id,
          b.name as brand_name,
          o.id as order_id,
          o.total,
          o.reception_date,
          EXTRACT(DAY FROM (CURRENT_DATE - o.reception_date::timestamp))::integer as days_in_warehouse
        FROM orders o
        INNER JOIN brands b ON o.brand_id = b.id
        WHERE ${whereClause}
      ),
      payments_by_order AS (
        SELECT 
          op.order_id,
          COALESCE(SUM(op.amount), 0) as total_paid
        FROM order_payments op
        WHERE op.order_id IN (SELECT order_id FROM warehouse_orders)
        GROUP BY op.order_id
      ),
      brand_aggregates AS (
        SELECT 
          wo.brand_id,
          SUM(wo.total) as total_in_warehouse,
          COALESCE(SUM(p.total_paid), 0) as total_recovered,
          CASE 
            WHEN SUM(wo.total) > 0 
            THEN (COALESCE(SUM(p.total_paid), 0) / SUM(wo.total) * 100)
            ELSE 0 
          END as recovery_rate,
          AVG(wo.days_in_warehouse) as avg_days_in_warehouse
        FROM warehouse_orders wo
        LEFT JOIN payments_by_order p ON wo.order_id = p.order_id
        GROUP BY wo.brand_id
        ${havingClause}
      )
      SELECT COUNT(*) as count FROM brand_aggregates
    `;

    const countParams = params.slice(0, -2); // Remove limit and offset
    const countResult = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      countQuery,
      ...countParams
    );
    const totalItems = Number(countResult[0]?.count || 0);

    // Transform results to domain types
    const items: BrandRecoveryMetrics[] = results.map((row) => ({
      brandId: row.brand_id,
      brandName: row.brand_name,
      totalInWarehouse: Number(row.total_in_warehouse),
      totalRecovered: Number(row.total_recovered),
      totalOutstanding: Number(row.total_outstanding),
      recoveryRate: Number(row.recovery_rate),
      orderCount: Number(row.order_count),
      avgDaysInWarehouse: Number(row.avg_days_in_warehouse),
      recoveryStatus: row.recovery_status,
    }));

    return {
      items,
      pagination: createPaginationMeta(totalItems, pagination),
    };
  }

  /**
   * Get client-level recovery metrics (stub - to be implemented)
   */
  async getClientMetrics(
    filters: RecoveryFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<ClientRecoveryMetrics>> {
    // TODO: Implement in next task
    throw new Error('Not implemented yet');
  }

  /**
   * Get recovery trends over time (stub - to be implemented)
   */
  async getRecoveryTrends(
    filters: RecoveryFilters,
    groupBy: TrendGroupBy
  ): Promise<RecoveryTrend[]> {
    // TODO: Implement in Phase 4
    throw new Error('Not implemented yet');
  }

  /**
   * Get recovery alerts (stub - to be implemented)
   */
  async getAlerts(filters: RecoveryFilters): Promise<RecoveryAlert[]> {
    // TODO: Implement in Phase 4
    throw new Error('Not implemented yet');
  }

  /**
   * Update alert status (stub - to be implemented)
   */
  async updateAlertStatus(alertId: string, status: AlertStatus): Promise<void> {
    // TODO: Implement in Phase 4
    throw new Error('Not implemented yet');
  }

  /**
   * Get detailed order breakdown for a brand (stub - to be implemented)
   */
  async getBrandOrderDetails(
    brandId: string,
    filters: RecoveryFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<any>> {
    // TODO: Implement when expanding brand details
    throw new Error('Not implemented yet');
  }

  /**
   * Get order and payment history for a client (stub - to be implemented)
   */
  async getClientOrderHistory(
    clientId: string,
    filters: RecoveryFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<any>> {
    // TODO: Implement when expanding client details
    throw new Error('Not implemented yet');
  }
}
