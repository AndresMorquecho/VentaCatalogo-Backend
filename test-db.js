const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const orders = await prisma.order.findMany({
      take: 1,
      select: { id: true, creditNoteNumber: true }
    });
    console.log('Column creditNoteNumber exists!');
  } catch (e) {
    console.error('Column DOES NOT exist:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
