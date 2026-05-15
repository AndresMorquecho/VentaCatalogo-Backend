import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const last = await p.deliveryBatch.findFirst({
    where: { deliveryNumber: { startsWith: 'EN-2026-' } },
    orderBy: { deliveryNumber: 'desc' },
    select: { deliveryNumber: true }
  });
  console.log('Last EN delivery:', last?.deliveryNumber);
  await p.$disconnect();
}
main();
