const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const locks = await prisma.systemLock.findMany();
  console.log('System Locks:', JSON.stringify(locks, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
