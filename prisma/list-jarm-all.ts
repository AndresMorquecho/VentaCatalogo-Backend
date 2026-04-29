import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { createdBy: 'JARM' },
        orderBy: { date: 'desc' }
    });
    console.log('Total records for JARM:', records.length);
    records.forEach(r => {
        console.log(`${r.date.toISOString()} | ${r.movementType} | ${r.amount} | ${r.notes}`);
    });
}
main().finally(() => prisma.$disconnect());
