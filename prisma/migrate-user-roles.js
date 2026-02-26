
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrate() {
    console.log('Migrating users to role names...');
    const users = await prisma.user.findMany();
    const roles = await prisma.role.findMany();

    for (const user of users) {
        // If role is a UUID (starts with hex-hex-hex-hex-hex)
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.role)) {
            const role = roles.find(r => r.id === user.role);
            if (role) {
                console.log(`Updating ${user.username}: ${user.role} -> ${role.name}`);
                await prisma.user.update({
                    where: { id: user.id },
                    data: { role: role.name }
                });
            }
        }
    }
    console.log('Migration complete.');
}

migrate().finally(() => prisma.$disconnect());
