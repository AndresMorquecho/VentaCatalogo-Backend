/**
 * transactionNotes.ts
 *
 * Central schema for FinancialRecord.notes field.
 * All new records MUST use buildNotesJSON() instead of free-form strings.
 * Legacy string-format notes are supported via parseNotesJSON() with fallback.
 */

import { randomUUID } from 'crypto';

// ─── Schema ──────────────────────────────────────────────────────────────────

export type TransactionModule =
  | 'ORDERS'
  | 'DELIVERY'
  | 'BATCH_DELIVERY'
  | 'RECEPTION'
  | 'WALLET'
  | 'EXCHANGE'
  | 'MANUAL';

export type CardTitle =
  | 'PAGO_EFECTIVO'
  | 'TRANSFERENCIA_BANCARIA'
  | 'DEPOSITO_BANCARIO'
  | 'PAGO_CHEQUE'
  | 'USO_BILLETERA'
  | 'RECARGA_BILLETERA'
  | 'TRASPASO_SALDO'
  | 'DEVOLUCION'
  | 'REEMBOLSO_CASH'
  | 'REEMBOLSO_BANCARIO'
  | 'PAGO_COMISION'
  | 'CAMBIO_MISMO_VALOR'
  | 'CAMBIO_CARGO_ADICIONAL'
  | 'CAMBIO_CREDITO'
  | 'VENTA_CATALOGO'
  | 'PAGO_MIXTO'
  // Phase 2.4 — Edit adjustment cards
  | 'AJUSTE_ABONO'         // Delta positivo (+) al editar
  | 'REDUCCION_ABONO'      // Delta negativo (-) al editar
  // Phase 3.3 — Method change & cancellation cards
  | 'CAMBIO_METODO_PAGO'   // Reversión + nuevo método
  | 'CANCELACION_PEDIDO'   // Eliminación de pedido con abono
  | 'ABONO';               // Generic payment label

export interface NotesOrderContext {
  receiptNumber: string;
  orderNumber?: string | null;
  brandName?: string | null;
  type?: string | null;
}

export interface NotesSchema {
  v: 2;                           // Schema version — bump when breaking changes
  title: CardTitle;
  module: TransactionModule;
  clientDoc: string;
  orders: NotesOrderContext[];
  description?: string;           // Note or description from user
  extra?: string;                 // Optional free-form context
}

// ─── Human-readable labels for each CardTitle ────────────────────────────────

export const CARD_TITLE_LABELS: Record<CardTitle, string> = {
  PAGO_EFECTIVO: 'Pago en Efectivo',
  TRANSFERENCIA_BANCARIA: 'Transferencia Bancaria',
  DEPOSITO_BANCARIO: 'Depósito Bancario',
  PAGO_CHEQUE: 'Pago con Cheque',
  USO_BILLETERA: 'Abono con Billetera Virtual',
  RECARGA_BILLETERA: 'Recarga de Billetera Virtual',
  TRASPASO_SALDO: 'Traspaso de Saldo (Wallet)',
  DEVOLUCION: 'Devolución',
  REEMBOLSO_CASH: 'Devolución en Efectivo',
  REEMBOLSO_BANCARIO: 'Devolución Bancaria',
  PAGO_COMISION: 'Pago de Comisión',
  CAMBIO_MISMO_VALOR: 'Cambio — Mismo Valor',
  CAMBIO_CARGO_ADICIONAL: 'Cargo Adicional por Cambio',
  CAMBIO_CREDITO: 'Crédito por Cambio',
  VENTA_CATALOGO: 'VENTAS - CATÁLOGO',
  PAGO_MIXTO: 'Pago Mixto',
  // Phase 2.4
  AJUSTE_ABONO: 'Ajuste de Abono (+)',
  REDUCCION_ABONO: 'Reducción de Abono (-)',
  // Phase 3.3
  CAMBIO_METODO_PAGO: 'Cambio de Método de Pago',
  CANCELACION_PEDIDO: 'Cancelación de Pedido',
  ABONO: 'ABONO',
};

// ─── Derive CardTitle from payment method ────────────────────────────────────

export function cardTitleFromMethod(paymentMethod: string): CardTitle {
  switch (paymentMethod.toUpperCase()) {
    case 'EFECTIVO':        return 'PAGO_EFECTIVO';
    case 'TRANSFERENCIA':   return 'TRANSFERENCIA_BANCARIA';
    case 'DEPOSITO':        return 'DEPOSITO_BANCARIO';
    case 'CHEQUE':          return 'PAGO_CHEQUE';
    case 'BILLETERA_VIRTUAL':
    case 'CREDITO_CLIENTE':
    case 'SALDO_A_FAVOR':   return 'USO_BILLETERA';
    default:                return 'PAGO_EFECTIVO';
  }
}

// ─── Build & Serialize ───────────────────────────────────────────────────────

export function buildNotesJSON(data: Omit<NotesSchema, 'v'>): string {
  const schema: NotesSchema = { v: 2, ...data };
  return JSON.stringify(schema);
}

// ─── Parse (with legacy fallback) ────────────────────────────────────────────

/**
 * Parses a notes string.
 * If the string is valid v2 JSON, returns it directly.
 * If it's a legacy pipe-separated string, converts it to the schema format.
 */
export function parseNotesJSON(notes: string | null | undefined): NotesSchema | null {
  if (!notes) return null;

  // Try JSON parse first
  try {
    const parsed = JSON.parse(notes);
    if (parsed?.v === 2) return parsed as NotesSchema;
  } catch {
    // fall through to legacy parsing
  }

  // Legacy pipe-format fallback
  return parseLegacyNotes(notes);
}

function parseLegacyNotes(notes: string): NotesSchema | null {
  const parts = notes.split('|').map(p => p.trim());
  const data: Partial<NotesSchema> = { v: 2, module: 'MANUAL', orders: [] };

  // Determine title from first segment
  const firstLower = (parts[0] || '').toLowerCase();
  if (firstLower.includes('efectivo')) data.title = 'PAGO_EFECTIVO';
  else if (firstLower.includes('transferencia')) data.title = 'TRANSFERENCIA_BANCARIA';
  else if (firstLower.includes('deposito') || firstLower.includes('depósito')) data.title = 'DEPOSITO_BANCARIO';
  else if (firstLower.includes('cheque')) data.title = 'PAGO_CHEQUE';
  else if (firstLower.includes('billetera') || firstLower.includes('crédito')) data.title = 'USO_BILLETERA';
  else if (firstLower.includes('recarga')) data.title = 'RECARGA_BILLETERA';
  else if (firstLower.includes('devolución') || firstLower.includes('devolucion') || firstLower.includes('reembolso')) data.title = 'REEMBOLSO_CASH';
  else if (firstLower.includes('cambio')) data.title = 'CAMBIO_MISMO_VALOR';
  else data.title = 'PAGO_EFECTIVO';

  let receiptNumber: string | undefined;
  let orderNumber: string | undefined;
  let brandName: string | undefined;
  let clientDoc = '';

  parts.forEach(part => {
    const lp = part.toLowerCase();
    const val = part.split(':').slice(1).join(':').trim();

    if (lp.startsWith('cédula') || lp.startsWith('cedula')) clientDoc = val;
    else if (lp.startsWith('orden:')) receiptNumber = val;
    else if (lp.startsWith('pedido:')) orderNumber = val;
    else if (lp.startsWith('marca:')) brandName = val;
    else if (lp.startsWith('comprobante:')) data.extra = `Comprobante: ${val}`;
  });

  data.clientDoc = clientDoc || 'S/N';
  if (receiptNumber) {
    data.orders = [{ receiptNumber, orderNumber, brandName }];
  }

  return data as NotesSchema;
}

// ─── Group ID Generator ───────────────────────────────────────────────────────

/**
 * Generates a new transactionGroupId.
 * Use this once per user action (e.g., per payment modal submit).
 * All FinancialRecord created in that action share the same groupId.
 */
export function generateGroupId(): string {
  return `GRP-${Date.now()}-${randomUUID().slice(0, 8)}`;
}
