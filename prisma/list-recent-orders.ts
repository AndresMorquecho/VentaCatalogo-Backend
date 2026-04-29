import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const orders = await prisma.order.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
        select: { receiptNumber: true, status: true, packingNumber: true, createdAt: true }
    });
    console.log(JSON.stringify(orders, null, 2));
}
main().finally(() => prisma.$disconnect());
