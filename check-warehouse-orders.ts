import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkWarehouseOrders() {
  try {
    console.log('Checking orders in warehouse...\n');

    // Count orders by status
    const ordersByStatus = await prisma.order.groupBy({
      by: ['status'],
      _count: true,
    });

    console.log('Orders by status:');
    ordersByStatus.forEach(({ status, _count }) => {
      console.log(`  ${status}: ${_count}`);
    });

    // Check orders in RECIBIDO_EN_BODEGA status
    const warehouseOrders = await prisma.order.findMany({
      where: {
        status: 'RECIBIDO_EN_BODEGA',
      },
      include: {
        brand: true,
      },
      take: 5,
    });

    console.log(`\nFound ${warehouseOrders.length} orders in RECIBIDO_EN_BODEGA status`);
    
    if (warehouseOrders.length > 0) {
      console.log('\nSample orders:');
      warehouseOrders.forEach((order) => {
        console.log(`  Order ${order.receiptNumber}: ${order.brand.name} - $${order.total}`);
      });
    }

    // Check if there are any orders at all
    const totalOrders = await prisma.order.count();
    console.log(`\nTotal orders in database: ${totalOrders}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkWarehouseOrders();
