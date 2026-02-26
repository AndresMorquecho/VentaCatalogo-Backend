
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const role = await prisma.role.findFirst({
        where: { name: { contains: 'cajera', mode: 'insensitive' } }
    });

    if (role) {
        console.log('Role found:', role.name);
        role.permissions.forEach(p => console.log(' - perm:', p));
    } else {
        console.log('Role "cajera" not found');
    }
}

check().finally(() => prisma.$disconnect());
