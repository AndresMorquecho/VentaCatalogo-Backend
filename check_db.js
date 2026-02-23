
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const accounts = await prisma.bankAccount.findMany();
    console.log(JSON.stringify(accounts, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2));
    process.exit(0);
}

check();
