const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const del = await prisma.systemLock.deleteMany();
  console.log('Cleared locks:', del.count);
}

main().catch(console.error).finally(() => prisma.$disconnect());
