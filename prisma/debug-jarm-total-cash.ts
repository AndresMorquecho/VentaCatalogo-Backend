import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { createdBy: 'JARM' },
        include: { bankAccount: true }
    });
    let t = 0;
    records.forEach(x => {
        const a = Number(x.amount);
        const isCash = x.bankAccount?.type === 'CASH';
        if (isCash) {
            if (x.movementType === 'INCOME') t += a;
            else if (x.movementType === 'EXPENSE') t -= a;
            // Internal movements in this DB seem to be informative for one side of a transfer
            // But let's check how they are stored.
        }
    });
    console.log('Total Cash Balance for JARM:', t);
}
main().finally(() => prisma.$disconnect());
