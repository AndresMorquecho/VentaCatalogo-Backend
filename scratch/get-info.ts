
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const client = await prisma.client.findFirst({
      select: { id: true, firstName: true }
    });
    const bank = await prisma.bankAccount.findFirst({
      where: { type: 'CASH', isActive: true },
      select: { id: true, name: true }
    });
    console.log(JSON.stringify({ client, bank }, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
