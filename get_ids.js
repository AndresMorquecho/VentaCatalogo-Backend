
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const brands = await prisma.brand.findMany({ take: 1 });
  const clients = await prisma.client.findMany({ take: 1 });
  const accounts = await prisma.bankAccount.findMany({ take: 1 });
  
  console.log('BRAND:', brands[0]?.id, brands[0]?.name);
  console.log('CLIENT:', clients[0]?.id, clients[0]?.firstName);
  console.log('ACCOUNT:', accounts[0]?.id, accounts[0]?.name);
}

main().catch(console.error).finally(() => prisma.$disconnect());
