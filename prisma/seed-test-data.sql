-- ============================================================================
-- SCRIPT DE DATOS DE PRUEBA PARA VENTASCATALOGO
-- ============================================================================
-- Ejecutar este script en la base de datos Neon para crear datos de prueba
-- Fecha: 23 de febrero de 2026
-- ============================================================================

-- Limpiar datos existentes (CUIDADO: Esto borra todo)
-- TRUNCATE TABLE reward_applications, client_credits, client_accounts, 
--   order_payments, order_items, orders, financial_records, 
--   inventory_movements, cash_closures, calls, 
--   bank_accounts, brands, clients, users CASCADE;

-- ============================================================================
-- 1. USUARIOS
-- ============================================================================

INSERT INTO users (id, email, password, name, role, is_active, created_at, updated_at)
VALUES 
  ('550e8400-e29b-41d4-a716-446655440001', 'admin@ventascatalogo.com', '$2b$10$YourHashedPasswordHere', 'Administrador', 'ADMIN', true, NOW(), NOW()),
  ('550e8400-e29b-41d4-a716-446655440002', 'user@ventascatalogo.com', '$2b$10$YourHashedPasswordHere', 'Usuario', 'USER', true, NOW(), NOW())
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- 2. CUENTAS BANCARIAS
-- ============================================================================

INSERT INTO bank_accounts (id, name, type, holder_name, bank_name, account_number, current_balance, is_active, description, created_at, updated_at, version)
VALUES 
  ('650e8400-e29b-41d4-a716-446655440001', 'Caja Efectivo', 'CASH', 'VentasCatalogo', 'N/A', 'CASH-001', 500.00, true, 'Caja principal para efectivo', NOW(), NOW(), 1),
  ('650e8400-e29b-41d4-a716-446655440002', 'Banco Pichincha', 'BANK', 'VentasCatalogo', 'Banco Pichincha', '2100123456', 1000.00, true, 'Cuenta corriente principal', NOW(), NOW(), 1),
  ('650e8400-e29b-41d4-a716-446655440003', 'Banco Guayaquil', 'BANK', 'VentasCatalogo', 'Banco Guayaquil', '0123456789', 750.00, true, 'Cuenta de ahorros', NOW(), NOW(), 1)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. MARCAS
-- ============================================================================

INSERT INTO brands (id, name, description, is_active, created_at)
VALUES 
  ('750e8400-e29b-41d4-a716-446655440001', 'Shein', 'Ropa y accesorios de moda', true, NOW()),
  ('750e8400-e29b-41d4-a716-446655440002', 'AliExpress', 'Productos variados de China', true, NOW()),
  ('750e8400-e29b-41d4-a716-446655440003', 'Amazon', 'Productos de Amazon USA', true, NOW()),
  ('750e8400-e29b-41d4-a716-446655440004', 'Temu', 'Productos económicos', true, NOW())
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 4. CLIENTES/EMPRESARIAS
-- ============================================================================

INSERT INTO clients (id, identification_type, identification_number, first_name, country, province, city, address, neighborhood, sector, email, phone1, operator1, phone2, operator2, reference, is_active, created_at, updated_at)
VALUES 
  ('850e8400-e29b-41d4-a716-446655440001', 'CEDULA', '1234567890', 'María García', 'Ecuador', 'Pichincha', 'Quito', 'Av. Principal 123', 'Centro', 'Norte', 'maria.garcia@example.com', '0987654321', 'Claro', '0999888777', 'Movistar', 'Cerca del parque', true, NOW(), NOW()),
  ('850e8400-e29b-41d4-a716-446655440002', 'CEDULA', '0987654321', 'Ana Rodríguez', 'Ecuador', 'Guayas', 'Guayaquil', 'Calle Secundaria 456', 'Sur', 'Centro', 'ana.rodriguez@example.com', '0991234567', 'Movistar', NULL, NULL, 'Frente al mercado', true, NOW(), NOW()),
  ('850e8400-e29b-41d4-a716-446655440003', 'CEDULA', '1122334455', 'Carmen López', 'Ecuador', 'Azuay', 'Cuenca', 'Av. Tercera 789', 'Este', 'Barranco', 'carmen.lopez@example.com', '0998765432', 'Claro', '0987123456', 'CNT', 'Al lado de la iglesia', true, NOW(), NOW()),
  ('850e8400-e29b-41d4-a716-446655440004', 'CEDULA', '5566778899', 'Laura Martínez', 'Ecuador', 'Pichincha', 'Quito', 'Calle Cuarta 321', 'Norte', 'Carapungo', 'laura.martinez@example.com', '0992345678', 'Movistar', NULL, NULL, 'Casa verde', true, NOW(), NOW())
ON CONFLICT (identification_number) DO NOTHING;

-- ============================================================================
-- 5. CUENTAS DE CLIENTES
-- ============================================================================

INSERT INTO client_accounts (id, client_id, total_credit_available, total_reward_points, total_orders, total_spent, reward_level, created_at, updated_at, version)
VALUES 
  ('950e8400-e29b-41d4-a716-446655440001', '850e8400-e29b-41d4-a716-446655440001', 0, 50, 5, 250.00, 'PLATA', NOW(), NOW(), 1),
  ('950e8400-e29b-41d4-a716-446655440002', '850e8400-e29b-41d4-a716-446655440002', 15.00, 30, 3, 150.00, 'BRONCE', NOW(), NOW(), 1),
  ('950e8400-e29b-41d4-a716-446655440003', '850e8400-e29b-41d4-a716-446655440003', 0, 80, 8, 400.00, 'ORO', NOW(), NOW(), 1),
  ('950e8400-e29b-41d4-a716-446655440004', '850e8400-e29b-41d4-a716-446655440004', 0, 10, 1, 50.00, 'BRONCE', NOW(), NOW(), 1)
ON CONFLICT (client_id) DO NOTHING;

-- ============================================================================
-- 6. PEDIDOS DE EJEMPLO
-- ============================================================================

-- Pedido 1: María García - Shein - POR_RECIBIR
INSERT INTO orders (id, receipt_number, sales_channel, type, brand_id, total, real_invoice_total, payment_method, bank_account_id, transaction_date, possible_delivery_date, reception_date, delivery_date, invoice_number, status, client_id, client_name, notes, created_at, updated_at, version)
VALUES 
  ('a50e8400-e29b-41d4-a716-446655440001', 'ORD-20260223-001', 'OFICINA', 'NORMAL', '750e8400-e29b-41d4-a716-446655440001', 50.00, NULL, 'EFECTIVO', '650e8400-e29b-41d4-a716-446655440001', '2026-02-23 10:00:00', '2026-03-05 10:00:00', NULL, NULL, NULL, 'POR_RECIBIR', '850e8400-e29b-41d4-a716-446655440001', 'María García', 'Pedido de vestidos', NOW(), NOW(), 1)
ON CONFLICT (receipt_number) DO NOTHING;

-- Pedido 2: Ana Rodríguez - AliExpress - POR_RECIBIR
INSERT INTO orders (id, receipt_number, sales_channel, type, brand_id, total, real_invoice_total, payment_method, bank_account_id, transaction_date, possible_delivery_date, reception_date, delivery_date, invoice_number, status, client_id, client_name, notes, created_at, updated_at, version)
VALUES 
  ('a50e8400-e29b-41d4-a716-446655440002', 'ORD-20260223-002', 'WHATSAPP', 'NORMAL', '750e8400-e29b-41d4-a716-446655440002', 75.00, NULL, 'TRANSFERENCIA', '650e8400-e29b-41d4-a716-446655440002', '2026-02-23 11:00:00', '2026-03-10 10:00:00', NULL, NULL, NULL, 'POR_RECIBIR', '850e8400-e29b-41d4-a716-446655440002', 'Ana Rodríguez', 'Productos electrónicos', NOW(), NOW(), 1)
ON CONFLICT (receipt_number) DO NOTHING;

-- Pedido 3: Carmen López - Amazon - RECIBIDO_EN_BODEGA (hace 3 días)
INSERT INTO orders (id, receipt_number, sales_channel, type, brand_id, total, real_invoice_total, payment_method, bank_account_id, transaction_date, possible_delivery_date, reception_date, delivery_date, invoice_number, status, client_id, client_name, notes, created_at, updated_at, version)
VALUES 
  ('a50e8400-e29b-41d4-a716-446655440003', 'ORD-20260220-001', 'OFICINA', 'NORMAL', '750e8400-e29b-41d4-a716-446655440003', 100.00, 85.00, 'EFECTIVO', '650e8400-e29b-41d4-a716-446655440001', '2026-02-20 09:00:00', '2026-03-01 10:00:00', '2026-02-20 14:00:00', NULL, 'FAC-2026-001', 'RECIBIDO_EN_BODEGA', '850e8400-e29b-41d4-a716-446655440003', 'Carmen López', 'Libros y juguetes', NOW(), NOW(), 1)
ON CONFLICT (receipt_number) DO NOTHING;

-- Pedido 4: Laura Martínez - Shein - RECIBIDO_EN_BODEGA (hace 8 días - ALERTA AMARILLA)
INSERT INTO orders (id, receipt_number, sales_channel, type, brand_id, total, real_invoice_total, payment_method, bank_account_id, transaction_date, possible_delivery_date, reception_date, delivery_date, invoice_number, status, client_id, client_name, notes, created_at, updated_at, version)
VALUES 
  ('a50e8400-e29b-41d4-a716-446655440004', 'ORD-20260215-001', 'DOMICILIO', 'PREVENTA', '750e8400-e29b-41d4-a716-446655440001', 60.00, 55.00, 'TRANSFERENCIA', '650e8400-e29b-41d4-a716-446655440002', '2026-02-15 10:00:00', '2026-02-25 10:00:00', '2026-02-15 16:00:00', NULL, 'FAC-2026-002', 'RECIBIDO_EN_BODEGA', '850e8400-e29b-41d4-a716-446655440004', 'Laura Martínez', 'Ropa de temporada', NOW(), NOW(), 1)
ON CONFLICT (receipt_number) DO NOTHING;

-- ============================================================================
-- 7. ITEMS DE PEDIDOS
-- ============================================================================

-- Items Pedido 1 (María García)
INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, brand_id, brand_name, link)
VALUES 
  ('b50e8400-e29b-41d4-a716-446655440001', 'a50e8400-e29b-41d4-a716-446655440001', 'Vestido floral', 2, 25.00, '750e8400-e29b-41d4-a716-446655440001', 'Shein', 'https://shein.com/product1')
ON CONFLICT (id) DO NOTHING;

-- Items Pedido 2 (Ana Rodríguez)
INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, brand_id, brand_name, link)
VALUES 
  ('b50e8400-e29b-41d4-a716-446655440002', 'a50e8400-e29b-41d4-a716-446655440002', 'Auriculares Bluetooth', 1, 35.00, '750e8400-e29b-41d4-a716-446655440002', 'AliExpress', 'https://aliexpress.com/product1'),
  ('b50e8400-e29b-41d4-a716-446655440003', 'a50e8400-e29b-41d4-a716-446655440002', 'Cable USB-C', 2, 20.00, '750e8400-e29b-41d4-a716-446655440002', 'AliExpress', 'https://aliexpress.com/product2')
ON CONFLICT (id) DO NOTHING;

-- Items Pedido 3 (Carmen López)
INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, brand_id, brand_name, link)
VALUES 
  ('b50e8400-e29b-41d4-a716-446655440004', 'a50e8400-e29b-41d4-a716-446655440003', 'Libro infantil', 3, 15.00, '750e8400-e29b-41d4-a716-446655440003', 'Amazon', 'https://amazon.com/product1'),
  ('b50e8400-e29b-41d4-a716-446655440005', 'a50e8400-e29b-41d4-a716-446655440003', 'Juguete educativo', 1, 55.00, '750e8400-e29b-41d4-a716-446655440003', 'Amazon', 'https://amazon.com/product2')
ON CONFLICT (id) DO NOTHING;

-- Items Pedido 4 (Laura Martínez)
INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, brand_id, brand_name, link)
VALUES 
  ('b50e8400-e29b-41d4-a716-446655440006', 'a50e8400-e29b-41d4-a716-446655440004', 'Blusa casual', 3, 20.00, '750e8400-e29b-41d4-a716-446655440001', 'Shein', 'https://shein.com/product2')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 8. PAGOS DE PEDIDOS
-- ============================================================================

-- Pago Pedido 1 (María García - Abono inicial)
INSERT INTO order_payments (id, order_id, amount, method, reference, description, created_at)
VALUES 
  ('c50e8400-e29b-41d4-a716-446655440001', 'a50e8400-e29b-41d4-a716-446655440001', 20.00, 'EFECTIVO', NULL, 'Abono inicial', NOW())
ON CONFLICT (id) DO NOTHING;

-- Pago Pedido 2 (Ana Rodríguez - Abono inicial)
INSERT INTO order_payments (id, order_id, amount, method, reference, description, created_at)
VALUES 
  ('c50e8400-e29b-41d4-a716-446655440002', 'a50e8400-e29b-41d4-a716-446655440002', 30.00, 'TRANSFERENCIA', 'TRANS-001', 'Abono inicial por transferencia', NOW())
ON CONFLICT (id) DO NOTHING;

-- Pago Pedido 3 (Carmen López - Abono inicial + Pago adicional)
INSERT INTO order_payments (id, order_id, amount, method, reference, description, created_at)
VALUES 
  ('c50e8400-e29b-41d4-a716-446655440003', 'a50e8400-e29b-41d4-a716-446655440003', 50.00, 'EFECTIVO', NULL, 'Abono inicial', '2026-02-20 09:00:00'),
  ('c50e8400-e29b-41d4-a716-446655440004', 'a50e8400-e29b-41d4-a716-446655440003', 30.00, 'EFECTIVO', NULL, 'Pago adicional', '2026-02-20 14:00:00')
ON CONFLICT (id) DO NOTHING;

-- Pago Pedido 4 (Laura Martínez - Abono inicial)
INSERT INTO order_payments (id, order_id, amount, method, reference, description, created_at)
VALUES 
  ('c50e8400-e29b-41d4-a716-446655440005', 'a50e8400-e29b-41d4-a716-446655440004', 40.00, 'TRANSFERENCIA', 'TRANS-002', 'Abono inicial', '2026-02-15 10:00:00')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 9. REGISTROS FINANCIEROS
-- ============================================================================

-- Registro Financiero Pedido 1 (María García - Abono inicial)
INSERT INTO financial_records (id, type, reference_number, amount, date, client_id, client_name, order_id, created_by, notes, bank_account_id, source, payment_method, movement_type, created_at, version)
VALUES 
  ('d50e8400-e29b-41d4-a716-446655440001', 'PAYMENT', 'FIN-20260223-0001', 20.00, '2026-02-23 10:00:00', '850e8400-e29b-41d4-a716-446655440001', 'María García', 'a50e8400-e29b-41d4-a716-446655440001', 'admin@ventascatalogo.com', 'Abono inicial pedido ORD-20260223-001', '650e8400-e29b-41d4-a716-446655440001', 'ORDER_PAYMENT', 'EFECTIVO', 'INCOME', NOW(), 1)
ON CONFLICT (reference_number) DO NOTHING;

-- Registro Financiero Pedido 2 (Ana Rodríguez - Abono inicial)
INSERT INTO financial_records (id, type, reference_number, amount, date, client_id, client_name, order_id, created_by, notes, bank_account_id, source, payment_method, movement_type, created_at, version)
VALUES 
  ('d50e8400-e29b-41d4-a716-446655440002', 'PAYMENT', 'FIN-20260223-0002', 30.00, '2026-02-23 11:00:00', '850e8400-e29b-41d4-a716-446655440002', 'Ana Rodríguez', 'a50e8400-e29b-41d4-a716-446655440002', 'admin@ventascatalogo.com', 'Abono inicial pedido ORD-20260223-002', '650e8400-e29b-41d4-a716-446655440002', 'ORDER_PAYMENT', 'TRANSFERENCIA', 'INCOME', NOW(), 1)
ON CONFLICT (reference_number) DO NOTHING;

-- Registro Financiero Pedido 3 (Carmen López - Abono inicial)
INSERT INTO financial_records (id, type, reference_number, amount, date, client_id, client_name, order_id, created_by, notes, bank_account_id, source, payment_method, movement_type, created_at, version)
VALUES 
  ('d50e8400-e29b-41d4-a716-446655440003', 'PAYMENT', 'FIN-20260220-0001', 50.00, '2026-02-20 09:00:00', '850e8400-e29b-41d4-a716-446655440003', 'Carmen López', 'a50e8400-e29b-41d4-a716-446655440003', 'admin@ventascatalogo.com', 'Abono inicial pedido ORD-20260220-001', '650e8400-e29b-41d4-a716-446655440001', 'ORDER_PAYMENT', 'EFECTIVO', 'INCOME', '2026-02-20 09:00:00', 1)
ON CONFLICT (reference_number) DO NOTHING;

-- Registro Financiero Pedido 3 (Carmen López - Pago adicional)
INSERT INTO financial_records (id, type, reference_number, amount, date, client_id, client_name, order_id, created_by, notes, bank_account_id, source, payment_method, movement_type, created_at, version)
VALUES 
  ('d50e8400-e29b-41d4-a716-446655440004', 'PAYMENT', 'FIN-20260220-0002', 30.00, '2026-02-20 14:00:00', '850e8400-e29b-41d4-a716-446655440003', 'Carmen López', 'a50e8400-e29b-41d4-a716-446655440003', 'admin@ventascatalogo.com', 'Pago adicional pedido ORD-20260220-001', '650e8400-e29b-41d4-a716-446655440001', 'ORDER_PAYMENT', 'EFECTIVO', 'INCOME', '2026-02-20 14:00:00', 1)
ON CONFLICT (reference_number) DO NOTHING;

-- Registro Financiero Pedido 4 (Laura Martínez - Abono inicial)
INSERT INTO financial_records (id, type, reference_number, amount, date, client_id, client_name, order_id, created_by, notes, bank_account_id, source, payment_method, movement_type, created_at, version)
VALUES 
  ('d50e8400-e29b-41d4-a716-446655440005', 'PAYMENT', 'FIN-20260215-0001', 40.00, '2026-02-15 10:00:00', '850e8400-e29b-41d4-a716-446655440004', 'Laura Martínez', 'a50e8400-e29b-41d4-a716-446655440004', 'admin@ventascatalogo.com', 'Abono inicial pedido ORD-20260215-001', '650e8400-e29b-41d4-a716-446655440002', 'ORDER_PAYMENT', 'TRANSFERENCIA', 'INCOME', '2026-02-15 10:00:00', 1)
ON CONFLICT (reference_number) DO NOTHING;

-- ============================================================================
-- 10. MOVIMIENTOS DE INVENTARIO
-- ============================================================================

-- Inventario Pedido 3 (Carmen López - Entrada a bodega)
INSERT INTO inventory_movements (id, order_id, client_id, brand_id, type, created_by, notes, created_at)
VALUES 
  ('e50e8400-e29b-41d4-a716-446655440001', 'a50e8400-e29b-41d4-a716-446655440003', '850e8400-e29b-41d4-a716-446655440003', '750e8400-e29b-41d4-a716-446655440003', 'ENTRY', 'admin@ventascatalogo.com', 'Recepción de pedido Amazon', '2026-02-20 14:00:00')
ON CONFLICT (id) DO NOTHING;

-- Inventario Pedido 4 (Laura Martínez - Entrada a bodega)
INSERT INTO inventory_movements (id, order_id, client_id, brand_id, type, created_by, notes, created_at)
VALUES 
  ('e50e8400-e29b-41d4-a716-446655440002', 'a50e8400-e29b-41d4-a716-446655440004', '850e8400-e29b-41d4-a716-446655440004', '750e8400-e29b-41d4-a716-446655440001', 'ENTRY', 'admin@ventascatalogo.com', 'Recepción de pedido Shein', '2026-02-15 16:00:00')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- RESUMEN DE DATOS CREADOS
-- ============================================================================

-- Usuarios: 2 (admin, user)
-- Cuentas Bancarias: 3 (Caja Efectivo, Banco Pichincha, Banco Guayaquil)
-- Marcas: 4 (Shein, AliExpress, Amazon, Temu)
-- Clientes: 4 (María, Ana, Carmen, Laura)
-- Cuentas de Clientes: 4 (con puntos y niveles)
-- Pedidos: 4 (2 POR_RECIBIR, 2 RECIBIDO_EN_BODEGA)
-- Items de Pedidos: 7 items en total
-- Pagos: 5 pagos (abonos iniciales y adicionales)
-- Registros Financieros: 5 registros
-- Movimientos de Inventario: 2 entradas a bodega

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================

-- Verificar datos creados
SELECT 'Usuarios' as tabla, COUNT(*) as total FROM users
UNION ALL
SELECT 'Cuentas Bancarias', COUNT(*) FROM bank_accounts
UNION ALL
SELECT 'Marcas', COUNT(*) FROM brands
UNION ALL
SELECT 'Clientes', COUNT(*) FROM clients
UNION ALL
SELECT 'Pedidos', COUNT(*) FROM orders
UNION ALL
SELECT 'Items de Pedidos', COUNT(*) FROM order_items
UNION ALL
SELECT 'Pagos', COUNT(*) FROM order_payments
UNION ALL
SELECT 'Registros Financieros', COUNT(*) FROM financial_records
UNION ALL
SELECT 'Movimientos de Inventario', COUNT(*) FROM inventory_movements;

