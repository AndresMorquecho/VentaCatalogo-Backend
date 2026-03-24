# Guía Completa: Tarjetas de Transacciones Financieras

## Índice
1. [Creación de Pedidos](#1-creación-de-pedidos)
2. [Recepción de Pedidos](#2-recepción-de-pedidos)
3. [Recarga de Billetera Virtual](#3-recarga-de-billetera-virtual)
4. [Abonos a Pedidos](#4-abonos-a-pedidos)
5. [Intercambios (Exchanges)](#5-intercambios-exchanges)

---

## 1. Creación de Pedidos

### 1.1 Pago Simple (Un solo método de pago)

#### Caso A: Pago en Efectivo
**Escenario:** Cliente hace pedido de $100 y paga $100 en efectivo

**FinancialRecords creados:**
- 1 registro: `INCOME` (EXTERNAL → CASH)

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💵 Pago en Efectivo        +$100.00    │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│ MARCA: Avon                            │
│                                         │
│ MOVIMIENTOS:                           │
│ 💵 Caja Chica                          │
│    Efectivo                            │
│    +$100.00                            │
│    Balance: $500.00 → $600.00          │
└─────────────────────────────────────────┘
```

#### Caso B: Pago con Billetera Virtual
**Escenario:** Cliente hace pedido de $100 y paga $100 con saldo a favor

**FinancialRecords creados:**
- 1 registro: `INTERNAL` (WALLET → ORDER)

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💜 Uso de Billetera Virtual  -$100.00  │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│ MARCA: Avon                            │
│                                         │
│ MOVIMIENTOS:                           │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    -$100.00                            │
│    Balance: $200.00 → $100.00          │
└─────────────────────────────────────────┘
```

### 1.2 Split Payment (Múltiples métodos de pago)

#### Caso C: Efectivo + Billetera Virtual
**Escenario:** Cliente hace pedido de $100, paga $50 en efectivo y $50 con saldo a favor

**FinancialRecords creados:**
- 1 registro: `INCOME` (EXTERNAL → CASH) - $50
- 1 registro: `INTERNAL` (WALLET → ORDER) - $50

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💵 Pago en Efectivo         +$50.00    │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│ MARCA: Avon                            │
│                                         │
│ MOVIMIENTOS:                           │
│ 💵 Caja Chica                          │
│    Efectivo                            │
│    +$50.00                             │
│    Balance: $500.00 → $550.00          │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 💜 Uso de Billetera Virtual  -$50.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│ MARCA: Avon                            │
│                                         │
│ MOVIMIENTOS:                           │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    -$50.00                             │
│    Balance: $200.00 → $150.00          │
└─────────────────────────────────────────┘
```

**Nota:** Ambas tarjetas apuntan al mismo pedido (mismo `orderId`)

---

## 2. Recepción de Pedidos

### 2.1 Recepción sin Saldo a Favor

#### Caso D: Valor Real = Valor Pagado
**Escenario:** Pedido de $100, se recibe con factura de $100

**FinancialRecords creados:**
- Ninguno (no hay diferencia)

**Tarjetas mostradas:**
- Ninguna tarjeta nueva (solo las del pago original)

#### Caso E: Valor Real > Valor Pagado (Falta pagar)
**Escenario:** Pedido de $100 (pagó $80), se recibe con factura de $100

**FinancialRecords creados:**
- Ninguno (queda saldo pendiente de $20)

**Tarjetas mostradas:**
- Ninguna tarjeta nueva

### 2.2 Recepción con Saldo a Favor (Sin Distribución)

#### Caso F: Saldo a Favor → Billetera Virtual (Automático)
**Escenario:** Pedido de $100 (pagó $100), se recibe con factura de $10. Saldo a favor: $90

**FinancialRecords creados:**
- 1 registro: `CREDIT_GENERATION` (INCOME) - $90
- 1 registro: `CREDIT_APPLICATION` (EXPENSE) - $90 (a billetera)

**ClientCredit creado:**
- 1 crédito de $90 disponible

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💰 Recarga Billetera Virtual  +$90.00  │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│                                         │
│ MOVIMIENTOS:                           │
│ 🏦 Banco Guayaquil                     │
│    Transferencia                       │
│    +$90.00                             │
│    Balance: $1000.00 → $1090.00        │
│                                         │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    +$90.00                             │
│    Balance: $100.00 → $190.00          │
└─────────────────────────────────────────┘
```

**Nota:** Se muestra como "Recarga" porque el dinero entra a la billetera del cliente

### 2.3 Recepción con Distribución de Saldo

#### Caso G: Devolución en Efectivo
**Escenario:** Pedido de $100 (pagó $100 en efectivo), factura $10. Se devuelven $90 en efectivo al cliente

**FinancialRecords creados:**
- 1 registro: `CREDIT_GENERATION` (INCOME) - $90
- 1 registro: `CREDIT_APPLICATION` (EXPENSE) - $90 (devolución efectivo)

**ClientCredit creado:**
- Ninguno (se devolvió en efectivo)

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💸 Devolución en Efectivo    -$90.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│                                         │
│ MOVIMIENTOS:                           │
│ 💵 Caja Chica                          │
│    Efectivo                            │
│    -$90.00                             │
│    Balance: $600.00 → $510.00          │
└─────────────────────────────────────────┘
```

**Nota:** Sale dinero de la caja porque se devuelve al cliente

#### Caso H: Distribución a Billetera Virtual
**Escenario:** Pedido de $100 (pagó $100), factura $10. Se ingresan $90 a billetera virtual

**FinancialRecords creados:**
- 1 registro: `CREDIT_GENERATION` (INCOME) - $90
- 1 registro: `CREDIT_APPLICATION` (EXPENSE) - $90 (a billetera)

**ClientCredit creado:**
- 1 crédito de $90 disponible

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💰 Recarga Billetera Virtual  +$90.00  │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│                                         │
│ MOVIMIENTOS:                           │
│ 🏦 Banco Guayaquil                     │
│    Transferencia                       │
│    +$90.00                             │
│    Balance: $1000.00 → $1090.00        │
│                                         │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    +$90.00                             │
│    Balance: $100.00 → $190.00          │
└─────────────────────────────────────────┘
```

#### Caso I: Distribución a Otros Pedidos
**Escenario:** Pedido A de $100 (pagó $100), factura $10. Se distribuyen $30 a Pedido B, $30 a Pedido C, $30 a Pedido D

**FinancialRecords creados:**
- 1 registro: `CREDIT_GENERATION` (INCOME) - $90
- 3 registros: `CREDIT_APPLICATION` (EXPENSE) - $30 cada uno (a pedidos B, C, D)
- 3 registros: `ORDER_PAYMENT` (INCOME) - $30 cada uno (en pedidos B, C, D)

**OrderPayments creados:**
- 3 pagos de $30 con método `CREDITO_CLIENTE` en pedidos B, C, D

**ClientCredit creado:**
- Ninguno (todo se distribuyó a pedidos)

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💜 Uso de Billetera Virtual  -$30.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-002 (Pedido B)    │
│ MARCA: Avon                            │
│                                         │
│ MOVIMIENTOS:                           │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    -$30.00                             │
│    Balance: $90.00 → $60.00            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 💜 Uso de Billetera Virtual  -$30.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-003 (Pedido C)    │
│ MARCA: Yanbal                          │
│                                         │
│ MOVIMIENTOS:                           │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    -$30.00                             │
│    Balance: $60.00 → $30.00            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 💜 Uso de Billetera Virtual  -$30.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-004 (Pedido D)    │
│ MARCA: Esika                           │
│                                         │
│ MOVIMIENTOS:                           │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    -$30.00                             │
│    Balance: $30.00 → $0.00             │
└─────────────────────────────────────────┘
```

**Nota:** Se crean 3 tarjetas separadas, una por cada pedido que recibe el saldo

#### Caso J: Distribución Mixta
**Escenario:** Pedido A de $100 (pagó $100), factura $10. Se distribuyen:
- $30 a Pedido B
- $30 a Pedido C
- $20 a billetera virtual
- $10 devolución en efectivo

**FinancialRecords creados:**
- 1 registro: `CREDIT_GENERATION` (INCOME) - $90
- 2 registros: `CREDIT_APPLICATION` (EXPENSE) - $30 cada uno (a pedidos B, C)
- 1 registro: `CREDIT_APPLICATION` (EXPENSE) - $20 (a billetera)
- 1 registro: `CREDIT_APPLICATION` (EXPENSE) - $10 (devolución efectivo)
- 2 registros: `ORDER_PAYMENT` (INCOME) - $30 cada uno (en pedidos B, C)

**OrderPayments creados:**
- 2 pagos de $30 con método `CREDITO_CLIENTE` en pedidos B y C

**ClientCredit creado:**
- 1 crédito de $20 disponible

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💜 Uso de Billetera Virtual  -$30.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-002 (Pedido B)    │
│ MARCA: Avon                            │
│                                         │
│ MOVIMIENTOS:                           │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    -$30.00                             │
│    Balance: $90.00 → $60.00            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 💜 Uso de Billetera Virtual  -$30.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-003 (Pedido C)    │
│ MARCA: Yanbal                          │
│                                         │
│ MOVIMIENTOS:                           │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    -$30.00                             │
│    Balance: $60.00 → $30.00            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 💰 Recarga Billetera Virtual  +$20.00  │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│                                         │
│ MOVIMIENTOS:                           │
│ 🏦 Banco Guayaquil                     │
│    Transferencia                       │
│    +$20.00                             │
│    Balance: $1000.00 → $1020.00        │
│                                         │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    +$20.00                             │
│    Balance: $30.00 → $50.00            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 💸 Devolución en Efectivo    -$10.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│                                         │
│ MOVIMIENTOS:                           │
│ 💵 Caja Chica                          │
│    Efectivo                            │
│    -$10.00                             │
│    Balance: $600.00 → $590.00          │
└─────────────────────────────────────────┘
```

**Nota:** Se crean 4 tarjetas: 2 para pagos a pedidos, 1 para recarga de billetera, 1 para devolución en efectivo

---

## 3. Recarga de Billetera Virtual

### 3.1 Recarga Manual (Pendiente de Validación)

#### Caso K: Recarga con Transferencia
**Escenario:** Cliente transfiere $500 para recargar su billetera virtual

**Paso 1: Creación de recarga (estado: PENDIENTE_VALIDACION)**
- No se crean FinancialRecords
- No se crean ClientCredits
- No se muestran tarjetas

**Paso 2: Validación de recarga**

**FinancialRecords creados:**
- 1 registro: `INCOME` (EXTERNAL → BANK_ACCOUNT) - $500
- 1 registro: `INTERNAL` (BANK_ACCOUNT → WALLET) - $500

**ClientCredit creado:**
- 1 crédito de $500 disponible

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💰 Recarga Billetera Virtual +$500.00  │
│                                         │
│ EMPRESARIA: María García                │
│                                         │
│ MOVIMIENTOS:                           │
│ 🏦 Banco Guayaquil                     │
│    Transferencia                       │
│    +$500.00                            │
│    Balance: $1000.00 → $1500.00        │
│                                         │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    +$500.00                            │
│    Balance: $50.00 → $550.00           │
└─────────────────────────────────────────┘
```

### 3.2 Recarga Instantánea

#### Caso L: Recarga Rápida desde Modal de Pago
**Escenario:** Cliente hace recarga instantánea de $200 con transferencia

**FinancialRecords creados:**
- 1 registro: `INCOME` (EXTERNAL → BANK_ACCOUNT) - $200
- 1 registro: `INTERNAL` (BANK_ACCOUNT → WALLET) - $200

**ClientCredit creado:**
- 1 crédito de $200 disponible

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💰 Recarga Billetera Virtual +$200.00  │
│                                         │
│ EMPRESARIA: María García                │
│                                         │
│ MOVIMIENTOS:                           │
│ 🏦 Banco Guayaquil                     │
│    Transferencia                       │
│    +$200.00                            │
│    Balance: $1500.00 → $1700.00        │
│                                         │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    +$200.00                            │
│    Balance: $550.00 → $750.00          │
└─────────────────────────────────────────┘
```

---

## 4. Abonos a Pedidos

### 4.1 Abono en Recepción

#### Caso M: Abono en Efectivo al Recibir Pedido
**Escenario:** Pedido de $100 (pagó $50), se recibe con factura de $100 y se abona $50 en efectivo

**FinancialRecords creados:**
- 1 registro: `INCOME` (EXTERNAL → CASH) - $50

**OrderPayment creado:**
- 1 pago de $50 con método `EFECTIVO`

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💵 Pago en Efectivo          +$50.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-001               │
│ MARCA: Avon                            │
│                                         │
│ MOVIMIENTOS:                           │
│ 💵 Caja Chica                          │
│    Efectivo                            │
│    +$50.00                             │
│    Balance: $590.00 → $640.00          │
└─────────────────────────────────────────┘
```

### 4.2 Abono desde Módulo de Abonos

#### Caso N: Abono con Transferencia
**Escenario:** Cliente abona $30 con transferencia a un pedido pendiente

**FinancialRecords creados:**
- 1 registro: `INCOME` (EXTERNAL → BANK_ACCOUNT) - $30

**OrderPayment creado:**
- 1 pago de $30 con método `TRANSFERENCIA`

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 🏦 Pago con Transferencia    +$30.00   │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-005               │
│ MARCA: Esika                           │
│                                         │
│ MOVIMIENTOS:                           │
│ 🏦 Banco Guayaquil                     │
│    Transferencia                       │
│    +$30.00                             │
│    Balance: $1700.00 → $1730.00        │
└─────────────────────────────────────────┘
```

---

## 5. Intercambios (Exchanges)

### 5.1 Intercambio con Diferencia a Favor del Cliente

#### Caso O: Producto Original $50, Nuevo Producto $30
**Escenario:** Cliente devuelve producto de $50, recibe producto de $30. Diferencia: $20 a favor

**FinancialRecords creados:**
- 1 registro: `CREDIT_GENERATION` (INCOME) - $20
- 1 registro: `CREDIT_APPLICATION` (EXPENSE) - $20 (a billetera)

**ClientCredit creado:**
- 1 crédito de $20 disponible

**Tarjetas mostradas:**
```
┌─────────────────────────────────────────┐
│ 💰 Recarga Billetera Virtual  +$20.00  │
│                                         │
│ EMPRESARIA: María García                │
│ PEDIDO: ORD-20260324-006 (Intercambio) │
│                                         │
│ MOVIMIENTOS:                           │
│ 🏦 Banco Guayaquil                     │
│    Transferencia                       │
│    +$20.00                             │
│    Balance: $1730.00 → $1750.00        │
│                                         │
│ 💜 Billetera Virtual                   │
│    María García                        │
│    +$20.00                             │
│    Balance: $750.00 → $770.00          │
└─────────────────────────────────────────┘
```

### 5.2 Intercambio con Diferencia a Favor de la Empresa

#### Caso P: Producto Original $30, Nuevo Producto $50
**Escenario:** Cliente devuelve producto de $30, recibe producto de $50. Diferencia: $20 a pagar

**FinancialRecords creados:**
- Ninguno (hasta que el cliente pague la diferencia)

**Tarjetas mostradas:**
- Ninguna (hasta que se pague)

---

## Resumen de Tipos de Tarjetas

| Tipo de Tarjeta | Condición | FinancialRecord Type | Movement Type |
|----------------|-----------|---------------------|---------------|
| **Pago en Efectivo** | Pago con EFECTIVO | PAYMENT | INCOME |
| **Pago con Transferencia** | Pago con TRANSFERENCIA/DEPOSITO/CHEQUE | PAYMENT | INCOME |
| **Uso de Billetera Virtual** | Pago con BILLETERA_VIRTUAL | PAYMENT | INTERNAL |
| **Recarga Billetera Virtual** | Validación de recarga o saldo a favor | PAYMENT | INCOME + INTERNAL |
| **Devolución en Efectivo** | Saldo a favor devuelto en efectivo | CREDIT_APPLICATION | EXPENSE |

---

## Campos Importantes en FinancialRecord

```typescript
{
  id: string
  type: 'PAYMENT' | 'CREDIT_GENERATION' | 'CREDIT_APPLICATION' | 'ORDER_PAYMENT'
  source: 'ORDER_PAYMENT' | 'MANUAL' | 'RECEPTION_OVERPAYMENT' | 'CREDIT_DISTRIBUTION' | 'CASH_RETURN'
  movementType: 'INCOME' | 'EXPENSE' | 'INTERNAL'
  fromAccountType: 'EXTERNAL' | 'BANK_ACCOUNT' | 'WALLET' | 'CASH'
  toAccountType: 'BANK_ACCOUNT' | 'WALLET' | 'ORDER' | 'CASH'
  paymentMethod: 'EFECTIVO' | 'TRANSFERENCIA' | 'DEPOSITO' | 'CHEQUE' | 'BILLETERA_VIRTUAL' | 'SALDO_A_FAVOR'
  amount: number
  balanceBefore: number | null  // Balance ANTES de la transacción
  balanceAfter: number | null   // Balance DESPUÉS de la transacción
  orderId: string | null        // ID del pedido relacionado
  clientId: string
  clientName: string
  bankAccountId: string
  notes: string                 // Incluye: "Pedido: XXX | Marca: YYY"
  userReference: string | null  // Número de recibo (OR-2026-XXX)
  transactionGroupId: string | null  // Agrupa INCOME + INTERNAL para recargas
}
```

---

## Lógica de Agrupación de Tarjetas

Las tarjetas de **Recarga de Billetera Virtual** agrupan 2 FinancialRecords:
1. **INCOME** (EXTERNAL → BANK_ACCOUNT) - Dinero que entra al banco
2. **INTERNAL** (BANK_ACCOUNT → WALLET) - Dinero que se transfiere a la billetera

Ambos registros comparten el mismo `transactionGroupId` para que el frontend los agrupe en una sola tarjeta.

---

## Notas Técnicas

1. **Balance Acumulativo:** Todos los FinancialRecords deben tener `balanceBefore` y `balanceAfter` para mostrar el balance acumulativo en las tarjetas.

2. **Número de Pedido y Marca:** Se extraen del campo `notes` usando regex:
   ```typescript
   const orderMatch = notes.match(/Pedido:\s*([^\|]+)/)
   const brandMatch = notes.match(/Marca:\s*([^\|]+)/)
   ```

3. **Origen del BankAccountId para Billetera Virtual:** Cuando se usa billetera virtual, el `bankAccountId` se obtiene del `FinancialRecord` de origen del crédito (FIFO), para mantener trazabilidad.

4. **ClientCredit.originTransactionId:** Debe apuntar al `FinancialRecord.id` de tipo `INCOME` que generó el crédito, NO al `WalletRecharge.id`.

---

## Casos Especiales

### Múltiples Pedidos con Split Payment
Cuando se pagan múltiples pedidos con split payment, los `FinancialRecord` tienen `orderId: null` porque el pago se distribuye entre varios pedidos.

### Recepción en Lote (Batch Reception)
Cuando se reciben múltiples pedidos en un lote, se crean todos los `FinancialRecord` en una sola transacción para optimizar el rendimiento.

### Distribución de Saldo con Resto
Si se distribuye saldo a pedidos y sobra un resto, ese resto puede:
- Ir a billetera virtual → Crea `ClientCredit` + tarjeta "Recarga"
- Devolverse en efectivo → Crea tarjeta "Devolución en Efectivo"
- Combinación de ambos

---

**Última actualización:** 24 de marzo de 2026
