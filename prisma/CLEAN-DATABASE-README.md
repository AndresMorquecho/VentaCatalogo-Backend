# Scripts de Limpieza de Base de Datos

Este directorio contiene scripts para limpiar la base de datos de desarrollo, eliminando todos los datos transaccionales pero preservando los datos maestros.

## 📋 ¿Qué se preserva?

Los siguientes datos **NO se eliminan**:

- ✅ **Clientes** (`clients`)
- ✅ **Marcas** (`brands`)
- ✅ **Cuentas Bancarias** (`bank_accounts`)

## 🗑️ ¿Qué se elimina?

Todos los datos transaccionales y operacionales:

- ❌ Órdenes (`orders`)
- ❌ Items de órdenes (`order_items`)
- ❌ Pagos de órdenes (`order_payments`)
- ❌ Registros financieros (`financial_records`)
- ❌ Cuentas de clientes (`client_accounts`)
- ❌ Créditos de clientes (`client_credits`)
- ❌ Aplicaciones de recompensas (`reward_applications`)
- ❌ Movimientos de inventario (`inventory_movements`)
- ❌ Cierres de caja (`cash_closures`)
- ❌ Llamadas (`calls`)
- ❌ Usuarios (`users`)
- ❌ Reglas de lealtad (`loyalty_rules`)
- ❌ Premios de lealtad (`loyalty_prizes`)

## 🚀 Métodos de Uso

### Opción 1: Script con Confirmación (Recomendado)

Este script pide confirmación antes de ejecutar y muestra estadísticas detalladas:

```bash
# Desde la raíz del proyecto
npm run db:clean --prefix backend

# O desde el directorio backend
npm run db:clean

# O directamente con node
node backend/prisma/run-clean.js
```

**Características:**
- ✅ Pide confirmación (debes escribir "SI")
- ✅ Muestra conteo de registros antes y después
- ✅ Muestra progreso detallado
- ✅ Colores en la consola para mejor legibilidad

### Opción 2: Limpieza Rápida (Sin Confirmación)

⚠️ **SOLO PARA DESARROLLO** - No pide confirmación:

```bash
# Desde la raíz del proyecto
npm run db:quick-clean --prefix backend

# O desde el directorio backend
npm run db:quick-clean

# O directamente con node
node backend/prisma/quick-clean.js
```

**Características:**
- ⚡ Ejecución inmediata sin confirmación
- 📊 Muestra resumen al final
- 🎯 Ideal para desarrollo rápido

### Opción 3: SQL Directo

Si prefieres ejecutar el SQL directamente:

```bash
# Usando psql
psql -h <host> -U <usuario> -d <database> -f backend/prisma/clean-database.sql

# O copiar el contenido de clean-database.sql y ejecutarlo en:
# - Prisma Studio
# - pgAdmin
# - DBeaver
# - Cualquier cliente SQL
```

## 📝 Ejemplos de Uso

### Caso 1: Limpiar después de pruebas

```bash
# Ejecutar pruebas
npm test

# Limpiar datos de prueba
npm run db:quick-clean --prefix backend

# Volver a sembrar datos de prueba si es necesario
npm run seed --prefix backend
```

### Caso 2: Reset completo de desarrollo

```bash
cd backend

# Limpiar base de datos
npm run db:clean

# Regenerar datos de prueba
npm run seed
```

### Caso 3: Automatizar en un script

```javascript
// scripts/reset-dev-db.js
const { execSync } = require('child_process');

console.log('🔄 Limpiando base de datos...');
execSync('npm run db:quick-clean', { cwd: 'backend', stdio: 'inherit' });

console.log('🌱 Sembrando datos de prueba...');
execSync('npm run seed', { cwd: 'backend', stdio: 'inherit' });

console.log('✅ Base de datos lista para desarrollo');
```

## ⚠️ Advertencias Importantes

### 🚨 NO USAR EN PRODUCCIÓN

Estos scripts están diseñados **EXCLUSIVAMENTE** para entornos de desarrollo y pruebas.

### 🔒 Protección de Producción

Para evitar accidentes, considera agregar una verificación en los scripts:

```javascript
// Al inicio del script
if (process.env.NODE_ENV === 'production') {
  console.error('❌ Este script NO debe ejecutarse en producción');
  process.exit(1);
}
```

### 💾 Backup Recomendado

Aunque estos scripts están diseñados para desarrollo, siempre es buena práctica:

```bash
# Hacer backup antes de limpiar
pg_dump -h <host> -U <usuario> -d <database> > backup_$(date +%Y%m%d_%H%M%S).sql

# Limpiar
npm run db:clean --prefix backend

# Si algo sale mal, restaurar
psql -h <host> -U <usuario> -d <database> < backup_20240223_143000.sql
```

## 🔍 Verificación Post-Limpieza

Después de ejecutar la limpieza, puedes verificar con:

```bash
# Abrir Prisma Studio
npm run prisma:studio --prefix backend

# O usar el script de verificación
node backend/prisma/check-db.js
```

## 📊 Salida Esperada

### Script con Confirmación (`db:clean`)

```
============================================
  LIMPIEZA DE BASE DE DATOS
============================================

⚠️  ADVERTENCIA: Esta operación es IRREVERSIBLE
Se eliminarán TODOS los datos excepto:
  ✓ Clientes
  ✓ Marcas
  ✓ Cuentas Bancarias

¿Está seguro que desea continuar? (escriba "SI" para confirmar): SI

🔄 Iniciando limpieza...

📊 Contando registros actuales...
Registros actuales:
  Clientes: 45
  Marcas: 12
  Cuentas bancarias: 5
  Órdenes: 234
  Registros financieros: 456

🗑️  Eliminando datos...
  → Eliminando usuarios...
  → Eliminando órdenes...
  ...

============================================
  ✅ LIMPIEZA COMPLETADA EXITOSAMENTE
============================================

Registros preservados:
  ✓ Clientes: 45
  ✓ Marcas: 12
  ✓ Cuentas bancarias: 5

Registros eliminados:
  ✗ Órdenes: 234 → 0
  ✗ Registros financieros: 456 → 0
  ...
```

### Script Rápido (`db:quick-clean`)

```
🔄 Limpieza rápida iniciada...

✅ Limpieza completada

Preservados:
  - 45 clientes
  - 12 marcas
  - 5 cuentas bancarias
```

## 🛠️ Troubleshooting

### Error: "Cannot find module '@prisma/client'"

```bash
cd backend
npm install
npx prisma generate
```

### Error: "Database connection failed"

Verifica tu archivo `.env`:

```bash
# backend/.env
DATABASE_URL="postgresql://usuario:password@host:5432/database?sslmode=require"
```

### Error: "Permission denied"

```bash
# Dar permisos de ejecución
chmod +x backend/prisma/*.js
```

## 📚 Archivos Incluidos

- `clean-database.sql` - Script SQL puro
- `run-clean.js` - Script Node.js con confirmación
- `quick-clean.js` - Script Node.js sin confirmación
- `CLEAN-DATABASE-README.md` - Esta documentación

## 🤝 Contribuir

Si encuentras mejoras o problemas:

1. Verifica que los scripts respeten el orden de dependencias
2. Asegúrate de que las tablas maestras se preserven
3. Prueba en un entorno de desarrollo primero
4. Documenta cualquier cambio

## 📄 Licencia

Estos scripts son parte del proyecto VentasCatalogo y siguen la misma licencia.
