import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addPortfolioIndexes() {
  console.log('Adding portfolio recovery indexes...');

  try {
    // Index 1: Composite index on status and reception_date
    console.log('Creating idx_orders_status_reception_date...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_reception_date 
        ON orders(status, reception_date) 
        WHERE status IN ('RECIBIDO_EN_BODEGA', 'ENTREGADO')
    `);

    // Index 2: Composite index on brand_id and status
    console.log('Creating idx_orders_brand_status...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_brand_status 
        ON orders(brand_id, status) 
        WHERE status IN ('RECIBIDO_EN_BODEGA', 'ENTREGADO')
    `);

    // Index 3: Composite index on client_id and status
    console.log('Creating idx_orders_client_status...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_client_status 
        ON orders(client_id, status) 
        WHERE status IN ('RECIBIDO_EN_BODEGA', 'ENTREGADO')
    `);

    // Index 4: Composite index on order_payments
    console.log('Creating idx_order_payments_order_created...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_payments_order_created 
        ON order_payments(order_id, created_at)
    `);

    console.log('✓ All indexes created successfully');

    // Verify indexes
    console.log('\nVerifying indexes...');
    const indexes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename IN ('orders', 'order_payments')
        AND (
          indexname LIKE 'idx_orders_status_reception_date%' OR
          indexname LIKE 'idx_orders_brand_status%' OR
          indexname LIKE 'idx_orders_client_status%' OR
          indexname LIKE 'idx_order_payments_order_created%'
        )
      ORDER BY tablename, indexname
    `);

    console.log('\nCreated indexes:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.tablename}.${idx.indexname}`);
    });

  } catch (error) {
    console.error('Error creating indexes:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

addPortfolioIndexes()
  .then(() => {
    console.log('\n✓ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Migration failed:', error);
    process.exit(1);
  });
