import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { 
            createdBy: 'JARM', 
            date: { lt: new Date('2026-04-28T00:00:00Z') } 
        }
    });
    let t = 0;
    records.forEach(x => {
        const a = Number(x.amount);
        if (x.movementType === 'INCOME') t += a;
        else t -= a;
    });
    console.log('Balance before 28/04 for JARM:', t);
}
main().finally(() => prisma.$disconnect());
