import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { 
            createdBy: 'JARM', 
            date: { gte: new Date('2026-04-29T00:00:00Z') } 
        }
    });
    console.log('Today records for JARM:', records.length);
    console.log(JSON.stringify(records, null, 2));
}
main().finally(() => prisma.$disconnect());
