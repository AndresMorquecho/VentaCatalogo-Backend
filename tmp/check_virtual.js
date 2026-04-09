const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const acc = await prisma.bankAccount.findUnique({ where: { id: 'virtual-credit-account' } });
  console.log(JSON.stringify(acc, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
