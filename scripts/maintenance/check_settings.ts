
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const settings = await prisma.systemSettings.findMany();
  console.log('--- System Settings ---');
  settings.forEach(s => {
    console.log(`${s.key}: ${s.value} (${s.description})`);
  });
}

main().then(() => prisma.$disconnect());
