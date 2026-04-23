import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const clients = await prisma.client.findMany({ take: 1 });
    console.log('CLIENTS:', clients);
  } catch (e) {
    console.error('ERROR:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
