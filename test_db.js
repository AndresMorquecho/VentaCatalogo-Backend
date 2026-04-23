const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.walletRecharge.findMany({orderBy: {createdAt: 'desc'}, take: 2})
  .then(console.log)
  .finally(() => prisma.$disconnect());
