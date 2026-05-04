/**
 * buildTransactionCards.ts
 *
 * Single source of truth for ALL transaction card logic.
 * Transforms raw FinancialRecord[] → TransactionCardDTO[].
 *
 * The frontend does ZERO financial logic — it only renders this output.
 */

import { parseNotesJSON, CARD_TITLE_LABELS } from '../../../shared/utils/transactionNotes';
import type { CardTitle, NotesSchema } from '../../../shared/utils/transactionNotes';

// ─── Shared DTO (also imported by frontend) ──────────────────────────────────

export type OperationType =
  | 'ABONO'
  | 'ENTREGA'
  | 'RECARGA'
  | 'REEMBOLSO'
  | 'CAMBIO'
  | 'TRASPASO'
  | 'VENTA_CATALOGO'
  | 'INTERNO';

export type AccountMovementType = 'CASH' | 'BANK' | 'WALLET';
export type MovementDirection = 'IN' | 'OUT';
export type CardMovementType = 'INCOME' | 'EXPENSE' | 'INTERNAL';

export interface CardMovement {
  accountType: AccountMovementType;
  accountName: string;
  direction: MovementDirection;
  amount: number;
  balanceBefore: number | null;
  balanceAfter: number | null;
  informative: boolean; // true = does NOT count in cash closure totals
}

export interface CardOrderContext {
  orderId: string | null;
  receiptNumber: string;
  orderNumber: string | null;
  brandName: string | null;
  type: string | null;
}

export interface TransactionCardDTO {
  // Identity
  id: string;
  rawRecordIds: string[];
  // Header
  title: CardTitle;
  titleLabel: string;         // Ready for UI: "Pago en Efectivo"
  operationType: OperationType;
  movementType: CardMovementType;
  totalAmount: number;        // Sum of non-informative real movements
  date: string;               // ISO 8601
  createdBy: string;
  reference: string | null;   // Comprobante / receipt number
  // Client
  clientName: string;
  clientDocument: string | null;
  // Context
  orders: CardOrderContext[];
  brands: string[];
  // Movements (the financial core)
  movements: CardMovement[];
  // Cash closure flags
  affectsCash: boolean;
  affectsBank: boolean;
  affectsWallet: boolean;
  isInternal: boolean;
  // Phase 4.2: Reversal flag — true = excluded from cash closure net totals
  isReversal: boolean;
  notes: string | null;
  extra: string | null;
}

// ─── Internal raw record shape (from Prisma includes) ────────────────────────

interface RawRecord {
  id: string;
  type: string;
  source: string;
  movementType: string;
  referenceNumber: string;
  userReference?: string | null;
  amount: number | { toNumber(): number };
  date: Date | string;
  clientId: string;
  clientName: string;
  clientDocument?: string | null;
  orderId?: string | null;
  createdBy: string;
  notes?: string | null;
  bankAccountId: string;
  paymentMethod?: string | null;
  fromAccountType?: string | null;
  toAccountType?: string | null;
  transactionGroupId?: string | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  // Phase 4.2
  isReversal?: boolean | null;
  adjustmentOf?: string | null;
  // Relations (when included)
  bankAccount?: { name: string; type: string } | null;
  order?: { 
    receiptNumber: string; 
    orderNumber: string | null; 
    brandName?: string | null; 
    type?: string | null;
    brand?: { name: string } | null;
  } | null;
}

// ─── Helper: normalize Decimal → number ──────────────────────────────────────

function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v);
}

// ─── 1. Group records by transactionGroupId ───────────────────────────────────

function groupRecords(records: RawRecord[]): Map<string, RawRecord[]> {
  const map = new Map<string, RawRecord[]>();
  for (const r of records) {
    // Skip internal-only accounting records that never appear in UI
    if (r.type === 'CREDIT_GENERATION') continue;

    const key = r.transactionGroupId ?? `SOLO-${r.id}`;
    const existing = map.get(key) ?? [];
    existing.push(r);
    map.set(key, existing);
  }
  return map;
}

// ─── 2. Select the primary record for a group ─────────────────────────────────

function selectPrimary(records: RawRecord[]): RawRecord {
  // Priority: INCOME > EXPENSE > INTERNAL
  return (
    records.find(r => r.movementType === 'INCOME') ??
    records.find(r => r.movementType === 'EXPENSE') ??
    records[0]
  );
}

// ─── 3. Resolve CardTitle from records ────────────────────────────────────────

function resolveTitle(records: RawRecord[]): CardTitle {
  const primary = selectPrimary(records);

  // 0. Detect cancellation (Phase 3.3) — highest priority
  if (records.some(r => r.source === 'ORDER_CANCELLATION')) return 'CANCELACION_PEDIDO';

  // 1. Detect method change (Phase 3.3)
  if (records.some(r => r.source === 'METHOD_CHANGE_REVERSAL') || records.some(r => r.source === 'METHOD_CHANGE_NEW')) return 'CAMBIO_METODO_PAGO';

  // 2. Detect edit adjustments (Phase 2.4)
  if (records.some(r => r.source === 'ORDER_EDIT' && r.movementType === 'EXPENSE')) return 'REDUCCION_ABONO';
  if (records.some(r => r.type === 'ADJUSTMENT' && r.source === 'ORDER_PAYMENT' && r.movementType === 'INCOME')) return 'AJUSTE_ABONO';

  // 3. Detect Mixed Payment
  const uniqueMethods = new Set(records.filter(r => r.movementType !== 'INTERNAL').map(r => r.paymentMethod).filter(pm => !!pm));
  if (uniqueMethods.size > 1) return 'PAGO_MIXTO';

  // Parse notes for v2 JSON
  const parsed = parseNotesJSON(primary.notes);
  if (parsed?.v === 2 && parsed.title) return parsed.title;

  // Derive from record fields (for legacy or non-standard records)
  const type = primary.type;
  const source = primary.source;
  const pm = primary.paymentMethod ?? '';

  if (type === 'EXCHANGE_SAME_VALUE') return 'CAMBIO_MISMO_VALOR';
  if (type === 'EXCHANGE_ADDITIONAL_CHARGE') return 'CAMBIO_CARGO_ADICIONAL';
  if (type === 'EXCHANGE_CREDIT') return 'CAMBIO_CREDITO';
  if (type === 'CASH_RETURN') return 'REEMBOLSO_CASH';
  if (type === 'CREDIT_APPLICATION' && source === 'CASH_RETURN') return 'DEVOLUCION';
  if (source === 'CREDIT_DISTRIBUTION') {
    if (primary.toAccountType === 'WALLET') return 'RECARGA_BILLETERA';
    return 'TRASPASO_SALDO';
  }
  if (source === 'MANUAL' && primary.movementType === 'INCOME') return 'RECARGA_BILLETERA';

  if (pm === 'EFECTIVO') return 'PAGO_EFECTIVO';
  if (pm === 'TRANSFERENCIA') return 'TRANSFERENCIA_BANCARIA';
  if (pm === 'DEPOSITO') return 'DEPOSITO_BANCARIO';
  if (pm === 'CHEQUE') return 'PAGO_CHEQUE';
  if (pm === 'BILLETERA_VIRTUAL' || pm === 'CREDITO_CLIENTE' || pm === 'SALDO_A_FAVOR') return 'USO_BILLETERA';

  return 'PAGO_EFECTIVO';
}

// ─── 4. Resolve OperationType ─────────────────────────────────────────────────

function resolveOperationType(records: RawRecord[], title: CardTitle): OperationType {
  const primary = selectPrimary(records);
  const parsed = parseNotesJSON(primary.notes);

  // New adjustment types
  if (title === 'CANCELACION_PEDIDO') return 'REEMBOLSO';
  if (title === 'AJUSTE_ABONO') return 'ABONO';
  if (title === 'REDUCCION_ABONO') return 'REEMBOLSO';
  if (title === 'CAMBIO_METODO_PAGO') return 'ABONO';

  // Use module from v2 notes if available
  if (parsed?.v === 2) {
    if (title === 'VENTA_CATALOGO') return 'VENTA_CATALOGO';
    const mod = parsed.module;
    if (mod === 'WALLET') return 'RECARGA';
    if (mod === 'DELIVERY' || mod === 'BATCH_DELIVERY') {
      if (title === 'USO_BILLETERA' || title === 'TRASPASO_SALDO') return 'ABONO';
      return 'ENTREGA';
    }
    if (mod === 'RECEPTION') return 'ABONO';
    if (mod === 'EXCHANGE') {
      if (title === 'USO_BILLETERA' || title === 'TRASPASO_SALDO' || title === 'CAMBIO_CREDITO') return 'ABONO';
      return 'CAMBIO';
    }
    if (mod === 'ORDERS') return 'ABONO';
  }

  // Derive from title
  if (title === 'VENTA_CATALOGO') return 'VENTA_CATALOGO';
  if (title === 'RECARGA_BILLETERA') return 'RECARGA';
  if (title === 'REEMBOLSO_CASH' || title === 'REEMBOLSO_BANCARIO' || title === 'DEVOLUCION' || title === 'DEVOLUCION_BILLETERA') return 'REEMBOLSO';
  if (title === 'TRASPASO_SALDO') return 'TRASPASO';
  if (title.startsWith('CAMBIO')) return 'CAMBIO';

  // Derive from order context (historical or manual records)
  const isCatalog = records.some(r => 
    r.order?.type?.toUpperCase() === 'CATALOGO' || 
    (parseNotesJSON(r.notes)?.orders.some(o => o.brandName?.toUpperCase().includes('CATAL')))
  );
  if (isCatalog) return 'VENTA_CATALOGO';

  // Derive from source/movementType
  const source = primary.source;
  if (source === 'CREDIT_DISTRIBUTION') return 'TRASPASO';
  if (source === 'MANUAL' && primary.movementType === 'INCOME') return 'RECARGA';

  return 'ABONO';
}

// ─── 5. Build movements[] for a group ────────────────────────────────────────

function resolveAccountType(record: RawRecord): AccountMovementType {
  // 1. Explicit Wallet flags have absolute highest priority
  if (record.toAccountType === 'WALLET' || record.fromAccountType === 'WALLET') return 'WALLET';
  if (record.paymentMethod === 'BILLETERA_VIRTUAL' || record.paymentMethod === 'CREDITO_CLIENTE') return 'WALLET';
  if (record.source === 'WALLET') return 'WALLET';

  // 2. Real bank/cash accounts
  if (record.bankAccount?.type === 'CASH') return 'CASH';
  if (record.bankAccount?.type !== 'CASH' && record.bankAccountId) return 'BANK';

  // 3. Fallbacks
  if (record.paymentMethod === 'EFECTIVO') return 'CASH';
  return 'BANK';
}

function buildMovements(records: RawRecord[], title: CardTitle): CardMovement[] {
  const movements: CardMovement[] = [];

  // Special case: EXCHANGE_SAME_VALUE has no real monetary movement
  if (title === 'CAMBIO_MISMO_VALOR') {
    return []; // Valid empty array per spec
  }

  for (const r of records) {
    const amount = toNum(r.amount);
    if (amount <= 0) continue;

    const accountType = resolveAccountType(r);
    const accountName = accountType === 'WALLET' ? 'Billetera Virtual' : (r.bankAccount?.name ?? 'Cuenta');
    const balanceBefore = r.balanceBefore != null ? toNum(r.balanceBefore) : null;
    const balanceAfter = r.balanceAfter != null ? toNum(r.balanceAfter) : null;

    // WALLET movements are always informative (except wallet-use which deducts real credit)
    // BUT if we have both USE (EXPENSE) and APPLY (INCOME), we make the USE informative 
    // to show the total applied in the card balance.
    const isWalletUse = r.source === 'WALLET' && r.movementType === 'EXPENSE';
    const isWalletApply = r.source === 'CREDIT_APPLICATION' && r.movementType === 'INCOME';
    
    let isInformativeWallet = accountType === 'WALLET' && r.movementType === 'INTERNAL';
    if (isWalletUse && records.some(rec => rec.source === 'CREDIT_APPLICATION' && rec.movementType === 'INCOME')) {
        isInformativeWallet = true; // Hide deduction from total if we show application
    }

    // DISTRIBUTION legs: 
    // BOTH are INFORMATIVE because they don't represent new money entering or leaving the system.
    // They are virtual shifts of credit between orders/wallet.
    const isDistribution = r.source === 'CREDIT_DISTRIBUTION';

    const informative = isInformativeWallet || isDistribution;

    // Direction: INCOME → IN, EXPENSE → OUT, INTERNAL → interpret from account types
    let direction: MovementDirection;
    if (r.movementType === 'INCOME') {
      direction = 'IN';
    } else if (r.movementType === 'EXPENSE') {
      direction = 'OUT';
    } else {
      // INTERNAL: wallet deduction is OUT, wallet credit is IN
      direction = (r.fromAccountType === 'WALLET') ? 'OUT' : 'IN';
    }

    movements.push({ accountType, accountName, direction, amount, balanceBefore, balanceAfter, informative });
  }

  return movements;
}

// ─── 6. Extract orders context ────────────────────────────────────────────────

function extractOrders(records: RawRecord[]): CardOrderContext[] {
  const seen = new Set<string>();
  const orders: CardOrderContext[] = [];

  // For Wallet/Distribution cards, prefer the Target order context (INCOME)
  const primary = selectPrimary(records);
  const title = resolveTitle(records);
  
  // If we have both legs of a distribution, or multiple records for an Abono,
  // ensure we highlight the order that received the money (the INCOME side)
  const targetRecords = (title === 'USO_BILLETERA' && records.length > 1)
    ? records.filter(r => r.movementType === 'INCOME')
    : records;

  for (const r of targetRecords) {
    // Try v2 JSON first
    const parsed = parseNotesJSON(r.notes);
    if (parsed?.v === 2 && parsed.orders.length > 0) {
      for (const o of parsed.orders) {
        const key = o.receiptNumber;
        if (!seen.has(key)) {
          seen.add(key);
          orders.push({
            orderId: r.orderId ?? null,
            receiptNumber: o.receiptNumber,
            orderNumber: o.orderNumber ?? null,
            brandName: o.brandName ?? null,
            type: null,
          });
        }
      }
      continue;
    }

    // Fallback: use relation data from includes
    if (r.order) {
      const key = r.order.receiptNumber;
      if (!seen.has(key)) {
        seen.add(key);
        orders.push({
          orderId: r.orderId ?? null,
          receiptNumber: r.order.receiptNumber,
          orderNumber: r.order.orderNumber ?? null,
          brandName: r.order.brandName ?? r.order.brand?.name ?? null,
          type: r.order.type ?? null,
        });
      }
    }
  }

  return orders;
}

// ─── 7. Extract unique brand names ────────────────────────────────────────────

function extractBrands(orders: CardOrderContext[]): string[] {
  const brands = new Set<string>();
  for (const o of orders) {
    if (o.brandName) brands.add(o.brandName);
  }
  return Array.from(brands);
}

// ─── 8. Calculate totalAmount (real movements only) ──────────────────────────

function calcTotalAmount(movements: CardMovement[]): number {
  // Solo consideramos movimientos informativos si es una transacción 100% interna
  const nonInformative = movements.filter(m => !m.informative);
  const targetMovements = nonInformative.length > 0 ? nonInformative : movements;

  return targetMovements.reduce((sum, m) => m.direction === 'IN' ? sum + m.amount : sum - m.amount, 0);
}

// ─── 9. Main builder function ─────────────────────────────────────────────────

function buildDTO(records: RawRecord[]): TransactionCardDTO {
  const primary = selectPrimary(records);
  const title = resolveTitle(records);
  const operationType = resolveOperationType(records, title);
  const orders = extractOrders(records);
  const brands = extractBrands(orders);
  const movements = buildMovements(records, title);
  const totalAmount = calcTotalAmount(movements);

  const parsedNotes = records.map(r => parseNotesJSON(r.notes)).filter(p => !!p) as NotesSchema[];
  
  // Find the most descriptive fields across all records in the group
  const firstWithDescription = parsedNotes.find(p => p.description && p.description.trim().length > 0);
  const firstWithExtra = parsedNotes.find(p => p.extra && p.extra.trim().length > 0);
  const firstWithOrders = parsedNotes.find(p => p.orders && p.orders.length > 0);

  // Notes extraction: v2 description > v1 raw notes (only if not JSON)
  let notes: string | null = null;
  const isV2 = parsedNotes.some(p => p.v === 2);

  if (firstWithDescription) {
    notes = firstWithDescription.description!;
  } else if (!isV2) {
    // ONLY fall back to raw notes IF it's not a v2 JSON record
    const rawNotes = primary.notes;
    if (rawNotes && !rawNotes.trim().startsWith('{')) {
      notes = rawNotes;
    }
  }

  // Extra extraction: v2 extra field
  const extra = firstWithExtra ? firstWithExtra.extra! : null;
  
  const affectsCash = movements.some(m => m.accountType === 'CASH' && !m.informative);
  const affectsBank = movements.some(m => m.accountType === 'BANK' && !m.informative);
  const affectsWallet = movements.some(m => m.accountType === 'WALLET');
  const isInternal = movements.every(m => m.informative) || primary.movementType === 'INTERNAL';

  return {
    id: primary.transactionGroupId ?? primary.id,
    rawRecordIds: records.map(r => r.id),
    title,
    titleLabel: CARD_TITLE_LABELS[title] ?? title,
    operationType,
    movementType: primary.movementType as CardMovementType,
    totalAmount,
    date: primary.date instanceof Date ? primary.date.toISOString() : String(primary.date),
    createdBy: primary.createdBy,
    reference: primary.userReference ?? primary.referenceNumber,
    clientName: primary.clientName,
    clientDocument: primary.clientDocument ?? null,
    orders: firstWithOrders ? firstWithOrders.orders.map(o => ({
      orderId: null,
      type: null,
      receiptNumber: o.receiptNumber,
      orderNumber: o.orderNumber ?? null,
      brandName: o.brandName ?? null
    })) : orders,
    brands,
    movements,
    affectsCash,
    affectsBank,
    affectsWallet,
    isInternal,
    // Phase 4.2: A card is a reversal if ALL its raw records are marked as reversals
    isReversal: records.every(r => r.isReversal === true),
    notes,
    extra,
  };
}

// ─── 10. Public entry point ───────────────────────────────────────────────────

export function buildTransactionCards(records: RawRecord[]): TransactionCardDTO[] {
  if (!records.length) return [];

  // Group by transactionGroupId (or solo-key for ungrouped)
  const grouped = groupRecords(records);

  // Build one DTO per group
  const cards: TransactionCardDTO[] = [];
  for (const [, groupRecords] of grouped) {
    cards.push(buildDTO(groupRecords));
  }

  // Sort by date descending (most recent first)
  cards.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return cards;
}
