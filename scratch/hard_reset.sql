-- Hard Reset SQL
TRUNCATE TABLE financial_records CASCADE;
TRUNCATE TABLE inventory_movements CASCADE;
TRUNCATE TABLE order_payments CASCADE;
TRUNCATE TABLE order_items CASCADE;
TRUNCATE TABLE catalog_deliveries CASCADE;
TRUNCATE TABLE order_exchange_items CASCADE;
TRUNCATE TABLE order_exchanges CASCADE;
TRUNCATE TABLE calls CASCADE;
TRUNCATE TABLE loyalty_redemptions CASCADE;
TRUNCATE TABLE client_credits CASCADE;
TRUNCATE TABLE client_accounts CASCADE;
TRUNCATE TABLE wallet_recharges CASCADE;
TRUNCATE TABLE orders CASCADE;
TRUNCATE TABLE clients CASCADE;
TRUNCATE TABLE cash_closures CASCADE;
UPDATE bank_accounts SET current_balance = 0;
