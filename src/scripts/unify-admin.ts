
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Limpieza y Unificación de Roles Administrativos ---');

    // 1. Obtener todos los permisos posibles del sistema (esto es estático basado en tu código anterior)
    const allPermissions = [
        "dashboard.view",
        "orders.view", "orders.create", "orders.edit", "orders.delete",
        "reception.view", "reception.confirm",
        "delivery.view", "delivery.confirm",
        "clients.view", "clients.create", "clients.edit", "clients.delete",
        "transactions.view",
        "payments.view", "payments.create", "payments.delete",
        "bank_accounts.view", "bank_accounts.create", "bank_accounts.edit", "bank_accounts.delete",
        "inventory.view", "inventory.edit",
        "brands.view", "brands.create", "brands.edit", "brands.delete",
        "cash_closure.view", "cash_closure.close",
        "calls.view", "calls.create",
        "loyalty.view", "loyalty.manage_rules", "loyalty.manage_prizes",
        "users.view", "users.create", "users.edit", "users.delete", "users.change_password", "users.assign_roles"
    ];

    // 2. Buscar roles que parezcan administrativos
    const roles = await prisma.role.findMany();
    const adminRoles = roles.filter(r =>
        r.name.toUpperCase() === 'ADMIN' ||
        r.name.toLowerCase().includes('administrador')
    );

    console.log('Roles administrativos detectados:', adminRoles.map(r => r.name));

    // 3. Asegurar que exista UN solo rol técnico llamado 'ADMIN' con TODO
    let mainAdminRole = roles.find(r => r.name === 'ADMIN');

    if (mainAdminRole) {
        console.log('Actualizando rol ADMIN existente con todos los permisos...');
        await prisma.role.update({
            where: { id: mainAdminRole.id },
            data: {
                permissions: allPermissions,
                description: 'Control Total del Sistema'
            }
        });
    } else {
        console.log('Creando rol ADMIN maestro...');
        mainAdminRole = await prisma.role.create({
            data: {
                name: 'ADMIN',
                description: 'Control Total del Sistema',
                permissions: allPermissions,
                isActive: true
            }
        });
    }

    // 4. Migrar usuarios de otros roles administrativos al rol 'ADMIN' único
    console.log('Migrando usuarios al nuevo estándar ADMIN...');
    await prisma.user.updateMany({
        where: {
            role: {
                in: adminRoles.map(r => r.name),
            }
        },
        data: {
            role: 'ADMIN'
        }
    });

    // 5. Eliminar duplicados (evitar el de nombre exacto 'ADMIN')
    const toDelete = adminRoles.filter(r => r.name !== 'ADMIN');
    for (const role of toDelete) {
        console.log(`Eliminando rol duplicado: ${role.name}`);
        try {
            await prisma.role.delete({ where: { id: role.id } });
        } catch (e) {
            console.log(`No se pudo eliminar ${role.name}, posiblemente tiene usuarios vinculados aún.`);
        }
    }

    console.log('\n¡Proceso completado! Todos los administradores ahora usan el rol técnico ADMIN con 40+ permisos.');

    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
