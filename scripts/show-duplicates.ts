import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function show() {
    const refs = ['952558229'];
    const records = await prisma.walletRecharge.findMany({
        where: { reference: { in: refs } },
        orderBy: { createdAt: 'desc' }
    });
    console.log('Duplicate Records:', JSON.stringify(records, null, 2));
    await prisma.$disconnect();
}
show();
