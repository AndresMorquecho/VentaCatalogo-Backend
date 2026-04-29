import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { 
            createdBy: 'JARM', 
            bankAccount: { type: { not: 'CASH' } } 
        },
        include: { bankAccount: true }
    });
    console.log('Non-cash records for JARM:', records.length);
    records.forEach(r => {
        console.log(`${r.date.toISOString()} | ${r.amount} | ${r.bankAccount?.name}`);
    });
}
main().finally(() => prisma.$disconnect());
