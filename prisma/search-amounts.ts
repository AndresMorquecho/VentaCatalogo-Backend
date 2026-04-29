import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { 
            OR: [
                { amount: 75.18 },
                { amount: 266.76 }
            ]
        },
        select: { id: true, amount: true, createdBy: true, date: true, notes: true }
    });
    console.log(JSON.stringify(records, null, 2));
}
main().finally(() => prisma.$disconnect());
