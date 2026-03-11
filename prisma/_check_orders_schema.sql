-- Verify DB has required columns/tables for Orders module

select
  to_regclass('public.orders') as orders_table,
  to_regclass('public.order_payments') as order_payments_table;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name in ('order_number', 'receipt_number', 'parent_order_id');

