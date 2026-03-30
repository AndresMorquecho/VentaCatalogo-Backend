const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    const orders = await prisma.order.findMany({
        where: { type: 'CAMBIO' },
        select: { receiptNumber: true, notes: true, orderNumber: true }
    });
    console.log(JSON.stringify(orders.slice(-10), null, 2));
    await prisma.$disconnect();
}
run();
