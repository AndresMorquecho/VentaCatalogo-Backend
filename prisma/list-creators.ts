import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const creators = await prisma.financialRecord.groupBy({
        by: ['createdBy']
    });
    console.log(JSON.stringify(creators, null, 2));
}
main().finally(() => prisma.$disconnect());
