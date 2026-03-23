ALTER TABLE exchange_batch_items ADD COLUMN IF NOT EXISTS financial_processed BOOLEAN NOT NULL DEFAULT false;
