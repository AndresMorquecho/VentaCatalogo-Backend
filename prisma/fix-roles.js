
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
    console.log('Activating all roles and checking users...');

    const roles = await prisma.role.updateMany({
        data: { isActive: true }
    });
    console.log(`Updated ${roles.count} roles to active.`);

    const users = await prisma.user.findMany();
    console.log('Current users:', users.map(u => ({ username: u.username, role: u.role, active: u.isActive })));

    const rolesList = await prisma.role.findMany();
    console.log('Current roles:', rolesList.map(r => r.name));
}

fix().finally(() => prisma.$disconnect());
