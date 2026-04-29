import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { 
            createdBy: 'JARM', 
            date: { 
                gte: new Date('2026-04-28T00:00:00Z'), 
                lte: new Date('2026-04-28T23:59:59Z') 
            } 
        }
    });
    console.log('Records for JARM on 28/04/2026:', records.length);
    let total = 0;
    records.forEach(r => {
        const amt = Number(r.amount);
        if (r.movementType === 'INCOME') total += amt;
        else total -= amt;
        console.log(`- ${r.date}: ${r.movementType} ${amt} (${r.notes})`);
    });
    console.log('Total:', total);
}
main().finally(() => prisma.$disconnect());
