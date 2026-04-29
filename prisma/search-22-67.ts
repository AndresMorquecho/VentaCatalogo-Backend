import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const records = await prisma.financialRecord.findMany({
        where: { amount: 22.67 }
    });
    console.log(JSON.stringify(records, null, 2));
}
main().finally(() => prisma.$disconnect());
