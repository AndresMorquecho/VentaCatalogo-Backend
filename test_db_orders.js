const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.order.findMany({where: {receiptNumber: {contains: '320987'}}})
  .then(console.log)
  .finally(() => prisma.$disconnect());
