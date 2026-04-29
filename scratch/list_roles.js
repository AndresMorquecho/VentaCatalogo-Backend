
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyze() {
  try {
    const roles = await prisma.role.findMany();
    console.log('--- ROLES AND PERMISSIONS ---');
    roles.forEach(r => {
      console.log(`Role: ${r.name}`);
      console.log(`Permissions: ${r.permissions.join(', ')}`);
      console.log('---');
    });
  } catch (error) {
    console.error('Error during analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyze();
