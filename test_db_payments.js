const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.orderPayment.findMany({where: {order: {receiptNumber: {contains: '320987'}}}})
  .then(console.log)
  .finally(() => prisma.$disconnect());
