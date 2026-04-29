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
        },
        include: { bankAccount: true }
    });
    console.log('--- JARM Records 28/04/2026 ---');
    let cashTotal = 0;
    records.forEach(r => {
        const amt = Number(r.amount);
        const isCash = r.bankAccount?.type === 'CASH';
        if (isCash) {
            if (r.movementType === 'INCOME') cashTotal += amt;
            else cashTotal -= amt;
        }
        console.log(`${r.date.toISOString()} | ${r.movementType} | ${amt} | Cash: ${isCash} | ${r.bankAccount?.name}`);
    });
    console.log('Net Cash:', cashTotal);
}
main().finally(() => prisma.$disconnect());
