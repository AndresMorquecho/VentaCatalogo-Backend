
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const brands = await prisma.brand.findMany({
      select: { id: true, name: true },
      take: 10
    });
    console.log(JSON.stringify(brands, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
