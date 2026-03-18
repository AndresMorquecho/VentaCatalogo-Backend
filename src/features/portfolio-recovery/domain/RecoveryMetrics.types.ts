/**
 * Portfolio Recovery Analysis - Domain Types
 * 
 * Defines the core domain types for recovery metrics, alerts, and trends.
 * These types represent the business domain and are used across all layers.
 */

// ============================================================================
// RECOVERY STATUS TYPES
// ============================================================================

/**
 * Recovery status classification based on recovery rate thresholds
 * - HEALTHY: Recovery rate > 50%
 * - WARNING: Recovery rate between 30% and 50%
 * - CRITICAL: Recovery rate < 30%
 */
export type RecoveryStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

/**
 * Alert type classification
 */
export type AlertType = 'LOW_RECOVERY_BRAND' | 'OLD_ORDER' | 'LATE_PAYMENT_PATTERN';

/**
 * Alert severity levels
 */
export type AlertSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Alert status for tracking resolution
 */
export type AlertStatus = 'NEW' | 'REVIEWED' | 'RESOLVED';

/**
 * Entity types that can be related to alerts
 */
export type RelatedEntityType = 'BRAND' | 'CLIENT' | 'ORDER';

// ============================================================================
// BRAND RECOVERY METRICS
// ============================================================================

/**
 * Breakdown of individual orders for a brand
 */
export interface OrderDetail {
  orderId: string;
  receiptNumber: string;
  clientName: string;
  total: number;
  totalPaid: number;
  outstanding: number;
  daysInWarehouse: number;
  receptionDate: Date;
}

/**
 * Brand-level recovery metrics
 * Aggregates all warehouse orders for a specific brand
 */
export interface BrandRecoveryMetrics {
  brandId: string;
  brandName: string;
  totalInWarehouse: number;
  totalRecovered: number;
  totalOutstanding: number;
  recoveryRate: number;
  orderCount: number;
  avgDaysInWarehouse: number;
  recoveryStatus: RecoveryStatus;
  orders?: OrderDetail[];
}

// ============================================================================
// CLIENT RECOVERY METRICS
// ============================================================================

/**
 * Brand breakdown for a specific client
 */
export interface BrandBreakdown {
  brandId: string;
  brandName: string;
  total: number;
  orderCount: number;
}

/**
 * Payment record for client history
 */
export interface PaymentRecord {
  id: string;
  amount: number;
  method: string;
  reference?: string;
  createdAt: Date;
}

/**
 * Client-level recovery metrics
 * Aggregates all warehouse orders for a specific client
 */
export interface ClientRecoveryMetrics {
  clientId: string;
  clientName: string;
  totalInWarehouse: number;
  totalRecovered: number;
  recoveryRate: number;
  orderCount: number;
  brandBreakdown: BrandBreakdown[];
  paymentHistory: PaymentRecord[];
  isHighRisk: boolean;
}

// ============================================================================
// RECOVERY TRENDS
// ============================================================================

/**
 * Time period grouping options for trend analysis
 */
export type TrendGroupBy = 'DAY' | 'WEEK' | 'MONTH';

/**
 * Recovery trend data point for a specific time period
 */
export interface RecoveryTrend {
  period: string; // ISO date string or period label
  totalInWarehouse: number;
  totalRecovered: number;
  recoveryRate: number;
  orderCount: number;
}

// ============================================================================
// RECOVERY ALERTS
// ============================================================================

/**
 * Recovery alert for critical situations requiring attention
 */
export interface RecoveryAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  suggestedAction: string;
  relatedEntityId: string;
  relatedEntityType: RelatedEntityType;
  createdAt: Date;
  status: AlertStatus;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Determines recovery status based on recovery rate
 * @param recoveryRate - Recovery rate percentage (0-100)
 * @returns Recovery status classification
 */
export function getRecoveryStatus(recoveryRate: number): RecoveryStatus {
  if (recoveryRate > 50) return 'HEALTHY';
  if (recoveryRate >= 30) return 'WARNING';
  return 'CRITICAL';
}

/**
 * Calculates recovery rate from totals
 * @param totalRecovered - Total amount recovered
 * @param totalInWarehouse - Total amount in warehouse
 * @returns Recovery rate percentage (0-100)
 */
export function calculateRecoveryRate(totalRecovered: number, totalInWarehouse: number): number {
  if (totalInWarehouse === 0) return 0;
  return (totalRecovered / totalInWarehouse) * 100;
}

/**
 * Calculates days in warehouse from reception date
 * @param receptionDate - Date when order was received in warehouse
 * @returns Number of days in warehouse
 */
export function calculateDaysInWarehouse(receptionDate: Date): number {
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - receptionDate.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}
