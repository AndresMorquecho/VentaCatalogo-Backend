-- ============================================================================
-- SCRIPT DE LIMPIEZA DE BASE DE DATOS
-- Elimina TODO excepto: Clientes, Bancos y Marcas
-- ============================================================================
-- IMPORTANTE: Este script elimina datos de forma permanente
-- Ejecutar con precaución en entornos de producción
-- ============================================================================

BEGIN;

-- Deshabilitar triggers temporalmente para mejorar performance
SET session_replication_role = 'replica';

-- ============================================================================
-- 1. ELIMINAR TABLAS SIN DEPENDENCIAS EXTERNAS
-- ============================================================================

-- Usuarios (no tiene dependencias)
TRUNCATE TABLE users CASCADE;

-- Reglas de lealtad y premios (no tienen dependencias)
TRUNCATE TABLE loyalty_rules CASCADE;
TRUNCATE TABLE loyalty_prizes CASCADE;

-- Cierres de caja (no tiene dependencias)
TRUNCATE TABLE cash_closures CASCADE;

-- ============================================================================
-- 2. ELIMINAR LLAMADAS (depende de clientes y órdenes)
-- ============================================================================

TRUNCATE TABLE calls CASCADE;

-- ============================================================================
-- 3. ELIMINAR MOVIMIENTOS DE INVENTARIO (depende de órdenes)
-- ============================================================================

TRUNCATE TABLE inventory_movements CASCADE;

-- ============================================================================
-- 4. ELIMINAR APLICACIONES DE RECOMPENSAS (depende de órdenes y cuentas)
-- ============================================================================

TRUNCATE TABLE reward_applications CASCADE;

-- ============================================================================
-- 5. ELIMINAR CRÉDITOS DE CLIENTES (depende de cuentas de clientes)
-- ============================================================================

TRUNCATE TABLE client_credits CASCADE;

-- ============================================================================
-- 6. ELIMINAR CUENTAS DE CLIENTES (depende de clientes)
-- ============================================================================

TRUNCATE TABLE client_accounts CASCADE;

-- ============================================================================
-- 7. ELIMINAR REGISTROS FINANCIEROS (depende de órdenes, clientes, bancos)
-- ============================================================================

TRUNCATE TABLE financial_records CASCADE;

-- ============================================================================
-- 8. ELIMINAR PAGOS DE ÓRDENES (depende de órdenes)
-- ============================================================================

TRUNCATE TABLE order_payments CASCADE;

-- ============================================================================
-- 9. ELIMINAR ITEMS DE ÓRDENES (depende de órdenes)
-- ============================================================================

TRUNCATE TABLE order_items CASCADE;

-- ============================================================================
-- 10. ELIMINAR ÓRDENES (tabla principal del agregado)
-- ============================================================================

TRUNCATE TABLE orders CASCADE;

-- ============================================================================
-- RESETEAR SECUENCIAS (si existen)
-- ============================================================================

-- No hay secuencias porque usamos UUIDs, pero por si acaso:
-- Si en el futuro se agregan campos con SERIAL, descomentar:
-- ALTER SEQUENCE IF EXISTS orders_id_seq RESTART WITH 1;

-- ============================================================================
-- VERIFICACIÓN: Contar registros restantes
-- ============================================================================

DO $$
DECLARE
    client_count INTEGER;
    brand_count INTEGER;
    bank_count INTEGER;
    order_count INTEGER;
    financial_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO client_count FROM clients;
    SELECT COUNT(*) INTO brand_count FROM brands;
    SELECT COUNT(*) INTO bank_count FROM bank_accounts;
    SELECT COUNT(*) INTO order_count FROM orders;
    SELECT COUNT(*) INTO financial_count FROM financial_records;
    
    RAISE NOTICE '============================================';
    RAISE NOTICE 'LIMPIEZA COMPLETADA';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'Clientes restantes: %', client_count;
    RAISE NOTICE 'Marcas restantes: %', brand_count;
    RAISE NOTICE 'Cuentas bancarias restantes: %', bank_count;
    RAISE NOTICE '--------------------------------------------';
    RAISE NOTICE 'Órdenes eliminadas: %', order_count;
    RAISE NOTICE 'Registros financieros eliminados: %', financial_count;
    RAISE NOTICE '============================================';
END $$;

-- Rehabilitar triggers
SET session_replication_role = 'origin';

COMMIT;

-- ============================================================================
-- NOTAS DE USO:
-- ============================================================================
-- Para ejecutar este script desde la terminal:
-- 
-- Opción 1 - Usando psql:
--   psql -h <host> -U <usuario> -d <database> -f backend/prisma/clean-database.sql
--
-- Opción 2 - Usando Prisma Studio:
--   Copiar y pegar el contenido en la consola SQL
--
-- Opción 3 - Desde Node.js:
--   node backend/prisma/run-clean.js
--
-- ============================================================================
-- TABLAS PRESERVADAS:
-- ✓ clients (Clientes)
-- ✓ brands (Marcas)
-- ✓ bank_accounts (Cuentas bancarias)
--
-- TABLAS ELIMINADAS:
-- ✗ orders (Órdenes)
-- ✗ order_items (Items de órdenes)
-- ✗ order_payments (Pagos de órdenes)
-- ✗ financial_records (Registros financieros)
-- ✗ client_accounts (Cuentas de clientes)
-- ✗ client_credits (Créditos de clientes)
-- ✗ reward_applications (Aplicaciones de recompensas)
-- ✗ inventory_movements (Movimientos de inventario)
-- ✗ cash_closures (Cierres de caja)
-- ✗ calls (Llamadas)
-- ✗ users (Usuarios)
-- ✗ loyalty_rules (Reglas de lealtad)
-- ✗ loyalty_prizes (Premios de lealtad)
-- ============================================================================
