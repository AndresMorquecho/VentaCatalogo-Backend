import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const batches = await prisma.receptionBatch.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { _count: { select: { orders: true } } }
    });
    console.log(JSON.stringify(batches, null, 2));
}
main().finally(() => prisma.$disconnect());
