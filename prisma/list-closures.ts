import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const closures = await prisma.cashClosure.findMany({
        orderBy: { toDate: 'desc' },
        take: 5
    });
    console.log(JSON.stringify(closures, null, 2));
}
main().finally(() => prisma.$disconnect());
