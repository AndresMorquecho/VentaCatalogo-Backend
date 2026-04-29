import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { createdBy: 'JARM' }
    });
    const found = records.filter(r => Number(r.amount) === 22.67);
    console.log(JSON.stringify(found, null, 2));
}
main().finally(() => prisma.$disconnect());
