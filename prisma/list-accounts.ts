import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const accounts = await prisma.bankAccount.findMany({
        select: { id: true, name: true, type: true, currentBalance: true }
    });
    console.log(JSON.stringify(accounts, null, 2));
}
main().finally(() => prisma.$disconnect());
