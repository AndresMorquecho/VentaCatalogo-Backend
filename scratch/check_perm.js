
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyze() {
  try {
    const roles = await prisma.role.findMany();
    const rolesWithViewAll = roles.filter(r => r.permissions.includes('cash_closure.view_all'));
    console.log(`Roles with cash_closure.view_all: ${rolesWithViewAll.map(r => r.name).join(', ') || 'NONE'}`);
    
    const adminRole = roles.find(r => r.name === 'ADMIN');
    if (adminRole) {
        console.log('ADMIN permissions list:');
        console.log(JSON.stringify(adminRole.permissions, null, 2));
    }
  } catch (error) {
    console.error('Error during analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyze();
