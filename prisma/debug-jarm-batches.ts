import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { 
            createdBy: 'JARM', 
            deliveryBatchId: { not: null } 
        }
    });
    console.log('Batch records for JARM:', records.length);
    records.forEach(r => {
        console.log(`${r.date.toISOString()} | ${r.amount} | ${r.deliveryBatchId}`);
    });
}
main().finally(() => prisma.$disconnect());
