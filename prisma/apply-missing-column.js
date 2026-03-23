const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Applying missing column: order_payments.processing_request_id...');

  await prisma.$executeRawUnsafe(`
    ALTER TABLE order_payments 
    ADD COLUMN IF NOT EXISTS processing_request_id UUID REFERENCES processing_requests(id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_order_payments_processing_request 
    ON order_payments(processing_request_id)
  `);

  console.log('Done. Column added successfully.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
