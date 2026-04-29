import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { createdBy: 'JARM' },
        orderBy: { date: 'desc' },
        take: 10
    });
    records.forEach(r => {
        console.log(`${r.date.toISOString()} | ${r.movementType} | ${r.amount} | ${r.notes}`);
    });
}
main().finally(() => prisma.$disconnect());
