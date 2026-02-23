
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const orders = await prisma.order.findMany({ select: { id: true, receiptNumber: true } });
    console.log(JSON.stringify(orders, null, 2));
    process.exit(0);
}

check();
