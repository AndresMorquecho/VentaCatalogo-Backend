const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.walletRecharge.findUnique({where: {id: 'fb3ed6fb-05e6-405f-8a72-6dfaf4197aba'}, include: {client: true}})
  .then(console.log)
  .finally(() => prisma.$disconnect());
