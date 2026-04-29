import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const orders = await prisma.order.findMany({
        where: { 
            OR: [
                { receiptNumber: 'OR-2026-002' },
                { orderNumber: 'OR-2026-002' }
            ]
        }
    });
    console.log(JSON.stringify(orders, null, 2));
}
main().finally(() => prisma.$disconnect());
