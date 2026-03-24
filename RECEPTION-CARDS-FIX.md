# Fix: Tarjetas de Transacciones de Recepción

## Problema Identificado

El backend **SÍ estaba creando** correctamente los `FinancialRecords` para los escenarios de recepción con saldo a favor, pero el frontend **NO los mostraba** porque la función `getCardType()` no reconocía estos tipos de registros.

## Cambios Realizados en el Frontend

### 1. Filtrado de `CREDIT_GENERATION`

**Archivo:** `Temu/src/features/transactions/ui/TransactionsTable.tsx`

**Cambio:** En la función `groupTransactions()`, ahora se filtran los registros de tipo `CREDIT_GENERATION` porque son solo contabilidad interna y no deben mostrarse como tarjetas separadas.

```typescript
// Add ungrouped records, but SKIP CREDIT_GENERATION (internal accounting only)
for (const t of ungrouped) {
    if (t.type !== 'CREDIT_GENERATION') {
        result.push({ primary: t })
    }
}
```

### 2. Detección de Tipo de Tarjeta Mejorada

**Función:** `getCardType()`

**Cambios:**
- Ahora detecta `CREDIT_APPLICATION` según su `source`:
  - `source: 'CASH_RETURN'` → Tarjeta de efectivo (devolución)
  - `source: 'CREDIT_DISTRIBUTION'` sin `orderId` → Tarjeta de recarga de billetera
  - `source: 'CREDIT_DISTRIBUTION'` con `orderId` → Tarjeta de uso de billetera

```typescript
// CREDIT_APPLICATION: Depends on source
if (type === 'CREDIT_APPLICATION') {
    // Cash return from reception overpayment
    if (source === 'CASH_RETURN') return 'cash'
    
    // Distribution to wallet (shows as recharge)
    if (source === 'CREDIT_DISTRIBUTION' && !t.orderId) return 'wallet-recharge'
    
    // Distribution to another order (shows as wallet use)
    if (source === 'CREDIT_DISTRIBUTION' && t.orderId) return 'wallet-use'
}
```

### 3. Títulos de Tarjetas Actualizados

**Función:** `getCardTitle()`

**Cambios:**
- Ahora reconoce `CREDIT_APPLICATION` con `source: 'CASH_RETURN'` y muestra "Devolución en Efectivo"
- Reconoce `CREDIT_APPLICATION` con `source: 'CREDIT_DISTRIBUTION'` y muestra "Recarga Billetera Virtual"

### 4. Movimientos de Recarga de Billetera Mejorados

**Función:** `WalletRechargeMovements()`

**Cambios:**
- Ahora maneja dos casos:
  1. **Recarga manual:** Muestra banco (real) + billetera (informativo)
  2. **Distribución de saldo a favor:** Muestra banco (informativo) + billetera (real)

```typescript
// CREDIT_APPLICATION from reception (distribution to wallet)
if (type === 'CREDIT_APPLICATION' && source === 'CREDIT_DISTRIBUTION') {
    // This is a credit distribution to wallet - show as informative only
    // The actual bank movement happened when the order was originally paid
    return (
        <>
            <MovementRow
                icon={<Building2 />}
                label="Cuenta Bancaria"
                detail="Saldo a favor aplicado"
                delta={t.amount}
                informative={true}  // ← Informativo
            />
            <MovementRow
                icon={<Wallet />}
                label="Billetera Virtual"
                delta={t.amount}
                informative={false}  // ← Real
            />
        </>
    )
}
```

### 5. Movimientos de Efectivo Mejorados

**Función:** `CashMovements()`

**Cambios:**
- Ahora detecta `CREDIT_APPLICATION` con `source: 'CASH_RETURN'` y muestra "Devolución al cliente"

```typescript
// CREDIT_APPLICATION with CASH_RETURN source (devolución en efectivo)
if (type === 'CREDIT_APPLICATION' && source === 'CASH_RETURN') {
    return (
        <MovementRow
            icon={<Banknote />}
            label="Caja / Efectivo"
            detail="Devolución al cliente"
            delta={-t.amount}
            deltaColor="text-red-500"
        />
    )
}
```

### 6. Fix de TypeScript

**Función:** `extractOrderInfo()`

**Cambio:** Ahora acepta `string | null | undefined` para evitar errores de tipo.

```typescript
function extractOrderInfo(notes: string | null | undefined): { orderNumber?: string; brandName?: string }
```

## Escenarios Ahora Soportados

### ✅ Caso F: Saldo a Favor → Billetera Virtual (Automático)

**Backend crea:**
- `CREDIT_GENERATION` (INCOME) - $90 ← NO se muestra
- `CREDIT_APPLICATION` (EXPENSE) - $90 ← SE MUESTRA como "Recarga Billetera Virtual"

**Frontend muestra:**
```
┌─────────────────────────────────────────┐
│ 💰 Recarga Billetera Virtual  +$90.00  │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│                                         │
│ MOVIMIENTOS:                           │
│ 🏦 Banco Guayaquil (informativo)       │
│    Saldo a favor aplicado              │
│    +$90.00                             │
│                                         │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    +$90.00                             │
│    Balance: $100.00 → $190.00          │
└─────────────────────────────────────────┘
```

### ✅ Caso G: Devolución en Efectivo

**Backend crea:**
- `CREDIT_GENERATION` (INCOME) - $90 ← NO se muestra
- `CREDIT_APPLICATION` (EXPENSE) - $90 con `source: 'CASH_RETURN'` ← SE MUESTRA

**Frontend muestra:**
```
┌─────────────────────────────────────────┐
│ 💸 Devolución en Efectivo    -$90.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│                                         │
│ MOVIMIENTOS:                           │
│ 💵 Caja Chica                          │
│    Devolución al cliente               │
│    -$90.00                             │
│    Balance: $600.00 → $510.00          │
└─────────────────────────────────────────┘
```

### ✅ Caso I: Distribución a Otros Pedidos

**Backend crea:**
- `CREDIT_GENERATION` (INCOME) - $90 ← NO se muestra
- `CREDIT_APPLICATION` (EXPENSE) - $30 x3 con `orderId` ← SE MUESTRAN como "Uso de Billetera Virtual"
- `ORDER_PAYMENT` (INCOME) - $30 x3 ← Registros internos

**Frontend muestra:** 3 tarjetas separadas de "Uso de Billetera Virtual", una por cada pedido

### ✅ Caso J: Distribución Mixta

**Backend crea:**
- `CREDIT_GENERATION` (INCOME) - $90 ← NO se muestra
- `CREDIT_APPLICATION` (EXPENSE) - $30 x2 a pedidos ← 2 tarjetas "Uso de Billetera Virtual"
- `CREDIT_APPLICATION` (EXPENSE) - $20 a billetera ← 1 tarjeta "Recarga Billetera Virtual"
- `CREDIT_APPLICATION` (EXPENSE) - $10 efectivo ← 1 tarjeta "Devolución en Efectivo"

**Frontend muestra:** 4 tarjetas en total

## Resumen

| Tipo de Registro | Source | orderId | Tarjeta Mostrada |
|-----------------|--------|---------|------------------|
| `CREDIT_GENERATION` | `RECEPTION_OVERPAYMENT` | Sí | ❌ NO se muestra (interno) |
| `CREDIT_APPLICATION` | `CASH_RETURN` | No | ✅ "Devolución en Efectivo" |
| `CREDIT_APPLICATION` | `CREDIT_DISTRIBUTION` | No | ✅ "Recarga Billetera Virtual" |
| `CREDIT_APPLICATION` | `CREDIT_DISTRIBUTION` | Sí | ✅ "Uso de Billetera Virtual" |
| `ORDER_PAYMENT` | `CREDIT_DISTRIBUTION` | Sí | ❌ NO se muestra (interno) |

## Testing

Para probar estos cambios:

1. Crear un pedido de $100 y pagarlo completamente
2. Recibir el pedido con factura de $10 (saldo a favor: $90)
3. Probar cada opción de distribución:
   - Devolución en efectivo → Debe aparecer tarjeta roja "Devolución en Efectivo"
   - A billetera virtual → Debe aparecer tarjeta morada "Recarga Billetera Virtual"
   - A otros pedidos → Debe aparecer tarjeta morada "Uso de Billetera Virtual" por cada pedido
   - Mixto → Deben aparecer múltiples tarjetas según la distribución

---

**Fecha:** 24 de marzo de 2026
**Archivos modificados:** `Temu/src/features/transactions/ui/TransactionsTable.tsx`
