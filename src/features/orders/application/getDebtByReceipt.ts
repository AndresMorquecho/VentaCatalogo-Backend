/**
 * getDebtByReceipt.ts
 *
 * Phase 2 Helper — Cuentas por Cobrar calculadas dinámicamente.
 *
 * MODELO DE PAGOS (Phase 5 Fix #3 — Delta-based):
 *   La tabla OrderPayment ahora puede contener DELTAS (isAdjustment=true).
 *   La deuda se calcula sumando TODOS los pagos (incluyendo deltas negativos):
 *     deuda_pedido = pedido.total - SUM(orderPayment.amount WHERE orderId = pedido.id)
 *
 * Ejemplo:
 *   Payment(amount=5, isAdjustment=false) → abono original
 *   Payment(amount=2, isAdjustment=true) → ajuste +2
 *   Payment(amount=-1, isAdjustment=true) → reducción -1
 *   Total pagado = 5 + 2 + (-1) = 6
 *
 * Esto garantiza consistencia sin necesidad de tabla adicional.
 */

import { prisma } from '../../../lib/prisma';

export interface OrderDebt {
  orderId: string;
  orderNumber: string | null;
  brandId: string;
  brandName: string;
  total: number;
  totalPaid: number;    // SUM of all OrderPayment.amount (including deltas)
  debt: number;
  isPaidInFull: boolean;
  hasOverpayment: boolean;
  paymentMethod: string;
}

export interface ReceiptDebtSummary {
  receiptNumber: string;
  clientId: string;
  clientName: string;
  totalOrders: number;
  grandTotal: number;
  totalPaid: number;
  totalDebt: number;
  totalOverpayment: number;
  orders: OrderDebt[];
  isFullyPaid: boolean;
}

/**
 * Calculates the current debt for a single order receipt.
 * Correctly handles delta-based OrderPayments (isAdjustment=true).
 * Always reads from DB — call this after any payment modification.
 */
export async function getDebtByReceipt(receiptNumber: string): Promise<ReceiptDebtSummary | null> {
  const orders = await prisma.order.findMany({
    where: { receiptNumber },
    include: {
      payments: { select: { amount: true, method: true } },
      brand: { select: { name: true } }
    }
  });

  if (orders.length === 0) return null;

  const firstOrder = orders[0];
  const orderDebts: OrderDebt[] = orders.map(o => {
    const total = Number(o.total);
    // Sum ALL payments including deltas (isAdjustment=true may have negative amounts)
    const totalPaid = o.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const difference = total - totalPaid;
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      brandId: o.brandId,
      brandName: (o as any).brand?.name || 'Sin marca',
      total,
      totalPaid,
      debt: Math.max(0, difference),
      isPaidInFull: difference <= 0.01,
      hasOverpayment: difference < -0.01,
      paymentMethod: o.paymentMethod
    };
  });

  const grandTotal = orderDebts.reduce((s, o) => s + o.total, 0);
  const totalPaid = orderDebts.reduce((s, o) => s + o.totalPaid, 0);
  const totalDebt = orderDebts.reduce((s, o) => s + o.debt, 0);
  const totalOverpayment = orderDebts
    .filter(o => o.hasOverpayment)
    .reduce((s, o) => s + (o.totalPaid - o.total), 0);

  return {
    receiptNumber,
    clientId: firstOrder.clientId,
    clientName: firstOrder.clientName,
    totalOrders: orders.length,
    grandTotal,
    totalPaid,
    totalDebt,
    totalOverpayment,
    orders: orderDebts,
    isFullyPaid: totalDebt <= 0.01 && totalOverpayment <= 0.01
  };
}

/**
 * Validates that a proposed new deposit does not exceed the order's total.
 * Phase 5 Fix #7: Used to prevent over-payment before creating financial records.
 */
export function validateDepositLimit(
  orderTotal: number,
  proposedNewTotalDeposit: number
): { allowed: boolean; reason?: string; maxAllowed: number } {
  const maxAllowed = orderTotal;
  if (proposedNewTotalDeposit > maxAllowed + 0.01) {
    return {
      allowed: false,
      reason: `El abono ($${proposedNewTotalDeposit.toFixed(2)}) excede el total del pedido ($${maxAllowed.toFixed(2)})`,
      maxAllowed
    };
  }
  return { allowed: true, maxAllowed };
}

/**
 * Returns the effective paid amount for a single order (sum of all OrderPayments including deltas).
 * Phase 5 Fix #3: Replaces any logic that only looks at the "first" payment.
 */
export async function getOrderPaidAmount(orderId: string): Promise<number> {
  const result = await prisma.orderPayment.aggregate({
    where: { orderId },
    _sum: { amount: true }
  });
  return Number(result._sum.amount || 0);
}
