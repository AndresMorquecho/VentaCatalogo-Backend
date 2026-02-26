
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Diagnóstico de Usuarios y Roles ---');

    const users = await prisma.user.findMany();
    console.log('Usuarios en base:', users.map(u => ({ id: u.id, username: u.username, role: u.role })));

    const roles = await prisma.role.findMany();
    console.log('Roles en base:', roles.map(r => ({ id: r.id, name: r.name, permissionsCount: r.permissions.length })));

    console.log('\n--- Buscando usuario Administrador ---');
    const adminUser = users.find(u => u.username.toLowerCase() === 'administrador');

    if (adminUser) {
        console.log(`Usuario "${adminUser.username}" encontrado con rol actual: "${adminUser.role}"`);

        // Asegurar que el rol ADMIN existe
        let adminRole = roles.find(r => r.name.toUpperCase() === 'ADMIN');
        if (!adminRole) {
            console.log('El rol ADMIN no existe. Creándolo...');
            adminRole = await prisma.role.create({
                data: {
                    name: 'ADMIN',
                    description: 'Administrador total del sistema',
                    permissions: ['dashboard.view', 'users.view', 'users.create', 'users.edit', 'users.delete', 'users.assign_roles'],
                    isActive: true
                }
            });
            console.log('Rol ADMIN creado.');
        }

        // Actualizar el usuario para que tenga el rol ADMIN exacto
        if (adminUser.role !== 'ADMIN') {
            console.log(`Actualizando usuario "${adminUser.username}" al rol ADMIN...`);
            await prisma.user.update({
                where: { id: adminUser.id },
                data: { role: 'ADMIN' }
            });
            console.log('Usuario actualizado exitosamente.');
        } else {
            console.log('El usuario ya tiene el rol ADMIN.');
        }
    } else {
        console.log('Usuario "Administrador" no encontrado. Revisa los nombres listados arriba.');
    }

    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
