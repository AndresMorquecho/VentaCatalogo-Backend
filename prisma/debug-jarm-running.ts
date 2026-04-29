import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { createdBy: 'JARM' },
        orderBy: { date: 'asc' }
    });
    console.log('--- ALL RECORDS FOR JARM ---');
    let running = 0;
    records.forEach(r => {
        const amt = Number(r.amount);
        if (r.movementType === 'INCOME') running += amt;
        else if (r.movementType === 'EXPENSE') running -= amt;
        console.log(`${r.date.toISOString()} | ${r.movementType} | ${amt} | Running: ${running.toFixed(2)} | ${r.notes}`);
    });
    console.log('--- END ---');
}
main().finally(() => prisma.$disconnect());
