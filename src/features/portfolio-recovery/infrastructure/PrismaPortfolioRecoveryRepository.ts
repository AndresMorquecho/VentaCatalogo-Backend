/**
 * Portfolio Recovery Analysis - Prisma Repository Implementation
 * 
 * Implements portfolio recovery data access using Prisma ORM with optimized SQL queries.
 * All aggregations are performed in the database for optimal performance.
 */

import { PrismaClient } from '@prisma/client';
import {
  BrandRecoveryMetrics,
  ClientRecoveryMetrics,
  RecoveryTrend,
  RecoveryAlert,
  TrendGroupBy,
  AlertStatus,
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
    const whereConditions: string[] = ["o.status IN ('RECIBIDO_EN_BODEGA', 'POR_RECIBIR', 'ENTREGADO')"];
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

    // Brand filter by IDs
    if (filters.brandIds && filters.brandIds.length > 0) {
      whereConditions.push(`o.brand_id = ANY($${paramIndex}::text[])`);
      params.push(filters.brandIds);
      paramIndex++;
    }

    // Brand filter by name (search)
    if (filters.brandName) {
      whereConditions.push(`b.name ILIKE $${paramIndex}`);
      params.push(`%${filters.brandName}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Build HAVING clause for post-aggregation filters
    const havingConditions: string[] = [];

    // Recovery status filter
    if (filters.recoveryStatus && filters.recoveryStatus !== 'ALL') {
      if (filters.recoveryStatus === 'HEALTHY') {
        havingConditions.push('(CASE WHEN SUM(wo.total) > 0 THEN (COALESCE(SUM(p.total_paid), 0) / SUM(wo.total) * 100) ELSE 0 END) > 50');
      } else if (filters.recoveryStatus === 'WARNING') {
        havingConditions.push('(CASE WHEN SUM(wo.total) > 0 THEN (COALESCE(SUM(p.total_paid), 0) / SUM(wo.total) * 100) ELSE 0 END) >= 30 AND (CASE WHEN SUM(wo.total) > 0 THEN (COALESCE(SUM(p.total_paid), 0) / SUM(wo.total) * 100) ELSE 0 END) <= 50');
      } else if (filters.recoveryStatus === 'CRITICAL') {
        havingConditions.push('(CASE WHEN SUM(wo.total) > 0 THEN (COALESCE(SUM(p.total_paid), 0) / SUM(wo.total) * 100) ELSE 0 END) < 30');
      }
    }

    // Min days in warehouse filter
    if (filters.minDaysInWarehouse !== undefined) {
      havingConditions.push(`AVG(wo.days_in_warehouse) >= ${filters.minDaysInWarehouse}`);
    }

    // Min amount filter
    if (filters.minAmount !== undefined) {
      havingConditions.push(`SUM(wo.total) >= ${filters.minAmount}`);
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
    _filters: RecoveryFilters,
    _pagination: Pagination
  ): Promise<PaginatedResult<ClientRecoveryMetrics>> {
    throw new Error('Not implemented yet');
  }

  /**
   * Get recovery trends over time
   */
  async getRecoveryTrends(
    _filters: RecoveryFilters,
    groupBy: TrendGroupBy
  ): Promise<RecoveryTrend[]> {
    // Determine date grouping based on groupBy parameter
    let dateGrouping: string;
    let periodFormat: string;
    
    switch (groupBy) {
      case 'DAY':
        dateGrouping = "DATE(o.reception_date)";
        periodFormat = 'YYYY-MM-DD';
        break;
      case 'WEEK':
        dateGrouping = "DATE_TRUNC('week', o.reception_date)::date";
        periodFormat = 'YYYY-MM-DD';
        break;
      case 'MONTH':
        dateGrouping = "DATE_TRUNC('month', o.reception_date)::date";
        periodFormat = 'YYYY-MM';
        break;
      default:
        dateGrouping = "DATE(o.reception_date)";
        periodFormat = 'YYYY-MM-DD';
    }

    const query = `
      WITH warehouse_orders AS (
        SELECT 
          o.id as order_id,
          o.total,
          o.reception_date,
          ${dateGrouping} as period_date
        FROM orders o
        WHERE o.status IN ('RECIBIDO_EN_BODEGA', 'POR_RECIBIR', 'ENTREGADO')
          AND o.reception_date IS NOT NULL
      ),
      payments_by_order AS (
        SELECT 
          op.order_id,
          COALESCE(SUM(op.amount), 0) as total_paid
        FROM order_payments op
        WHERE op.order_id IN (SELECT order_id FROM warehouse_orders)
        GROUP BY op.order_id
      )
      SELECT 
        TO_CHAR(wo.period_date, '${periodFormat}') as period,
        SUM(wo.total) as total_in_warehouse,
        COALESCE(SUM(p.total_paid), 0) as total_recovered,
        CASE 
          WHEN SUM(wo.total) > 0 
          THEN (COALESCE(SUM(p.total_paid), 0) / SUM(wo.total) * 100)
          ELSE 0 
        END as recovery_rate,
        COUNT(DISTINCT wo.order_id) as order_count
      FROM warehouse_orders wo
      LEFT JOIN payments_by_order p ON wo.order_id = p.order_id
      GROUP BY wo.period_date
      ORDER BY wo.period_date ASC
    `;

    const results = await this.prisma.$queryRawUnsafe<any[]>(query);

    return results.map((row) => ({
      period: row.period,
      totalInWarehouse: Number(row.total_in_warehouse),
      totalRecovered: Number(row.total_recovered),
      recoveryRate: Number(row.recovery_rate),
      orderCount: Number(row.order_count),
    }));
  }

  /**
   * Get list of brands with orders in warehouse (for filter dropdowns)
   */
  async getBrandsList(): Promise<Array<{ id: string; name: string }>> {
    const query = `
      SELECT DISTINCT
        b.id,
        b.name
      FROM brands b
      INNER JOIN orders o ON o.brand_id = b.id
      WHERE o.status IN ('RECIBIDO_EN_BODEGA', 'POR_RECIBIR', 'ENTREGADO')
        AND b.is_active = true
      ORDER BY b.name ASC
    `;

    const results = await this.prisma.$queryRawUnsafe<any[]>(query);

    return results.map((row) => ({
      id: row.id,
      name: row.name,
    }));
  }

  /**
   * Get recovery alerts (stub - to be implemented)
   */
  async getAlerts(_filters: RecoveryFilters): Promise<RecoveryAlert[]> {
    throw new Error('Not implemented yet');
  }

  /**
   * Update alert status (stub - to be implemented)
   */
  async updateAlertStatus(_alertId: string, _status: AlertStatus): Promise<void> {
    throw new Error('Not implemented yet');
  }

  /**
   * Get detailed order breakdown for a brand (stub - to be implemented)
   */
  async getBrandOrderDetails(
    _brandId: string,
    _filters: RecoveryFilters,
    _pagination: Pagination
  ): Promise<PaginatedResult<any>> {
    throw new Error('Not implemented yet');
  }

  /**
   * Get order and payment history for a client (stub - to be implemented)
   */
  async getClientOrderHistory(
    _clientId: string,
    _filters: RecoveryFilters,
    _pagination: Pagination
  ): Promise<PaginatedResult<any>> {
    throw new Error('Not implemented yet');
  }
}
