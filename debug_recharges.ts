
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const recharges = await prisma.walletRecharge.findMany({
    include: { client: true }
  });
  console.log('RECHARGES:', JSON.stringify(recharges, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
