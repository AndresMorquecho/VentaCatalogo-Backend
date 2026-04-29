import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { createdBy: 'JARM' },
        orderBy: { date: 'asc' }
    });
    const daily: Record<string, number> = {};
    records.forEach(r => {
        const date = r.date.toISOString().split('T')[0];
        const amt = Number(r.amount);
        if (r.movementType === 'INCOME') daily[date] = (daily[date] || 0) + amt;
        else if (r.movementType === 'EXPENSE') daily[date] = (daily[date] || 0) - amt;
    });
    console.log('Daily Totals for JARM:');
    console.log(JSON.stringify(daily, null, 2));
}
main().finally(() => prisma.$disconnect());
