-- Crear cuenta bancaria virtual para trazabilidad de saldos a favor
-- Esta cuenta siempre debe tener balance 0 (entrada = salida)

INSERT INTO bank_accounts (
  id, 
  name, 
  type, 
  holder_name,
  bank_name,
  account_number,
  current_balance, 
  is_active,
  description,
  created_at,
  updated_at,
  version
) VALUES (
  'virtual-credit-account',
  'Cuenta Virtual - Saldos a Favor',
  'VIRTUAL',
  'Sistema',
  'Cuenta Virtual',
  'VIRTUAL-001',
  0.00,
  true,
  'Cuenta virtual para trazabilidad de saldos a favor. Balance siempre debe ser 0.',
  NOW(),
  NOW(),
  1
) ON CONFLICT (id) DO NOTHING;

-- Verificar que se creó correctamente
SELECT * FROM bank_accounts WHERE id = 'virtual-credit-account';