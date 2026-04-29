import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const orders = await prisma.order.findMany({
        where: { packingNumber: 'PK-2026-002' },
        select: { id: true, status: true, receiptNumber: true, orderNumber: true }
    });
    console.log(`Found ${orders.length} orders for PK-2026-002`);
    console.log(JSON.stringify(orders.slice(0, 5), null, 2));
}
main().finally(() => prisma.$disconnect());
