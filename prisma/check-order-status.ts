import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const order = await prisma.order.findFirst({
        where: { 
            OR: [
                { receiptNumber: 'OR-2026-002' },
                { orderNumber: 'OR-2026-002' }
            ]
        },
        select: { id: true, status: true, packingNumber: true, receiptNumber: true, orderNumber: true }
    });
    console.log(JSON.stringify(order, null, 2));
}
main().finally(() => prisma.$disconnect());
