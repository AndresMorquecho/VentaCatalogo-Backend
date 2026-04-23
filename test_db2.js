const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.walletRecharge.findMany({where: {client: {firstName: {contains: 'BETSY'}}}, orderBy: {createdAt: 'desc'}})
  .then(console.log)
  .finally(() => prisma.$disconnect());
