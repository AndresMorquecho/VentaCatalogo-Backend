# Script de Aplicación de Correcciones de Concurrencia

## ESTADO ACTUAL

✅ **Infraestructura completada:**
- Custom errors creados
- Helpers de retry y validación creados
- Helpers de optimistic locking creados
- Schema actualizado con campo `version` en ClientCredit
- Índices compuestos agregados
- Migración SQL lista

✅ **Archivos parcialmente corregidos:**
- `CreateOrder.usecase.ts` - BankAccount corregido ✅, ClientCredit pendiente ⏳

## CORRECCIONES APLICADAS MANUALMENTE

### 1. CreateOrder.usecase.ts
**Ubicación:** Línea 287 (BankAccount)
**Estado:** ✅ CORREGIDO

**Cambios aplicados:**
- Agregados imports de ConcurrencyError y validaciones
- Lectura de BankAccount con versión antes de actualizar
- Validación de integridad financiera
- Actualización con `updateMany` y validación de versión
- Manejo de ConcurrencyError

## CORRECCIONES PENDIENTES

Debido a la extensión del trabajo (35 ubicaciones en 16 archivos), las correcciones restantes deben aplicarse siguiendo el patrón documentado en `docs/concurrency-fix-implementation-guide.md`.

### Archivos CRÍTICOS pendientes (5 archivos):

1. **CreateOrder.usecase.ts** - ClientCredit (línea 311) ⏳
2. **BatchCreateOrder.usecase.ts** - BankAccount (línea 272), ClientCredit (línea 307) ⏳
3. **DeliverOrder.usecase.ts** - BankAccount (línea 162), ClientCredit (línea 139), ClientAccount (línea 153) ⏳
4. **BatchDeliverOrders.usecase.ts** - BankAccount (línea 150), ClientCredit (línea 135), ClientAccount (líneas 145, 240) ⏳
5. **ReceiveOrder.usecase.ts** - BankAccount (línea 228) ⏳
6. **RegisterOrderPayment.usecase.ts** - BankAccount (línea 97), ClientCredit (línea 122), ClientAccount (línea 141) ⏳

### Archivos ALTA PRIORIDAD pendientes (4 archivos):

7. **DeleteOrder.usecase.ts** - BankAccount (líneas 55, 63), ClientAccount (línea 93) ⏳
8. **DeleteReceptionBatch.usecase.ts** - BankAccount (línea 46), ClientAccount (línea 73) ⏳
9. **BatchUpdateOrders.usecase.ts** - BankAccount (líneas 82, 176, 201, 298) ⏳
10. **CreateReceptionBatch.usecase.ts** - BankAccount (líneas 55, 129) ⏳

### Archivos MEDIA PRIORIDAD pendientes (6 archivos):

11. **OrderController.ts** - BankAccount (líneas 356, 382, 766), ClientAccount (línea 793) ⏳
12. **PaymentController.ts** - BankAccount (líneas 112, 154) ⏳
13. **PrismaFinancialRecordRepository.ts** - BankAccount (línea 155) ⏳
14. **PrismaBankAccountRepository.ts** - BankAccount (línea 29) ⏳
15. **ValidateWalletRecharges.usecase.ts** - BankAccount (línea 105), ClientAccount (línea 75) ⏳
16. **bankAccounts.routes.ts** - BankAccount (línea 130) ⏳
17. **clientCredits.routes.ts** - ClientCredit (línea 192) ⏳
18. **loyalty.routes.ts** - ClientAccount (línea 288) ⏳

## PATRÓN DE CORRECCIÓN A APLICAR

### Para BankAccount:
```typescript
// 1. Leer con versión
const account = await tx.bankAccount.findUnique({
  where: { id: bankAccountId },
  select: { id: true, currentBalance: true, version: true, name: true }
});

if (!account) {
  throw new Error(`Bank account ${bankAccountId} not found`);
}

// 2. Validar integridad
validateBankAccountBalance(
  Number(account.currentBalance),
  amount,
  bankAccountId,
  account.name
);

// 3. Actualizar con optimistic locking
const result = await tx.bankAccount.updateMany({
  where: {
    id: bankAccountId,
    version: account.version
  },
  data: {
    currentBalance: { increment: amount },
    updatedAt: new Date(),
    version: { increment: 1 }
  }
});

if (result.count === 0) {
  throw new ConcurrencyError(
    'Bank account was modified by another transaction',
    'BankAccount',
    bankAccountId
  );
}
```

### Para ClientCredit:
```typescript
// 1. Leer con versión (en el findMany inicial)
const availableCredits = await tx.clientCredit.findMany({
  where: { ... },
  select: {
    id: true,
    remainingAmount: true,
    version: true,
    status: true
  }
});

// 2. En el loop, validar y actualizar
const newRemaining = Number(credit.remainingAmount) - amountToSubtract;
const newStatus = newRemaining <= 0.01 ? 'USED' : 'AVAILABLE';

validateClientCreditBalance(
  Number(credit.remainingAmount),
  amountToSubtract,
  credit.id
);

const result = await tx.clientCredit.updateMany({
  where: {
    id: credit.id,
    version: credit.version
  },
  data: {
    remainingAmount: { decrement: amountToSubtract },
    status: newStatus,
    usedAt: newStatus === 'USED' ? new Date() : undefined,
    version: { increment: 1 }
  }
});

if (result.count === 0) {
  throw new ConcurrencyError(
    'Client credit was modified by another transaction',
    'ClientCredit',
    credit.id
  );
}
```

### Para ClientAccount:
```typescript
// Cambiar de update() a updateMany()
const result = await tx.clientAccount.updateMany({
  where: {
    id: clientAccount.id,
    version: clientAccount.version
  },
  data: {
    totalCreditAvailable: { decrement: amount },
    updatedAt: new Date(),
    version: { increment: 1 }
  }
});

if (result.count === 0) {
  throw new ConcurrencyError(
    'Client account was modified by another transaction',
    'ClientAccount',
    clientAccount.id
  );
}
```

## INSTRUCCIONES PARA CONTINUAR

1. **Ejecutar migración:**
   ```bash
   cd backend
   npx prisma migrate deploy
   npx prisma generate
   npm run build
   ```

2. **Aplicar correcciones archivo por archivo:**
   - Seguir el orden de prioridad (CRÍTICO → ALTO → MEDIO)
   - Usar el patrón documentado arriba
   - Compilar y probar después de cada archivo
   - Hacer commit después de cada archivo corregido

3. **Verificar cada corrección:**
   ```bash
   npx tsc --noEmit
   npm test (si existen tests)
   ```

4. **Testing manual** de cada funcionalidad corregida

5. **Code review** antes de merge a main

## TIEMPO ESTIMADO RESTANTE

- Archivos críticos: 6-8 horas
- Archivos alta prioridad: 4-6 horas
- Archivos media prioridad: 3-4 horas
- Testing: 4-6 horas
- **Total: 17-24 horas (2-3 días)**

## RECURSOS

- Guía completa: `docs/concurrency-fix-implementation-guide.md`
- Helpers: `backend/src/shared/utils/optimisticLocking.ts`
- Validaciones: `backend/src/shared/utils/financialValidations.ts`
- Errors: `backend/src/shared/errors/`

---

**Última actualización:** 16 de Marzo de 2026  
**Estado:** Infraestructura completa, 1 de 35 ubicaciones corregidas
