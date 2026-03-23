-- Fix: Add missing processing_request_id column to order_payments
-- This column was defined in the Prisma schema but the migration had it commented out.

ALTER TABLE order_payments 
ADD COLUMN IF NOT EXISTS processing_request_id UUID REFERENCES processing_requests(id);

CREATE INDEX IF NOT EXISTS idx_order_payments_processing_request 
ON order_payments(processing_request_id);
