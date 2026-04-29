
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Limpieza y Unificación de Roles Administrativos ---');

    // 1. Obtener todos los permisos posibles del sistema (esto es estático basado en tu código anterior)
    const allPermissions = [
        "dashboard.view",
        "orders.view", "orders.create", "orders.edit", "orders.delete", "orders.export_excel", "orders.edit_price", "orders.save_with_zero_deposit", "orders.delete_item",
        "reception.view", "reception.confirm", "reception.edit", "reception.delete", "reception.export_excel",
        "delivery.view", "delivery.confirm", "delivery.dismantle", "delivery.return", "delivery.export_excel",
        "clients.view", "clients.create", "clients.edit", "clients.delete", "clients.export_excel", "clients.update",
        "transactions.view", "transactions.export_excel",
        "payments.view", "payments.create", "payments.delete", "payments.export_excel",
        "bank_accounts.view", "bank_accounts.create", "bank_accounts.edit", "bank_accounts.delete", "bank_accounts.manage",
        "inventory.view", "inventory.edit", "inventory.manage", "inventory.export_excel",
        "brands.view", "brands.create", "brands.edit", "brands.delete", "brands.manage",
        "cash_closure.view", "cash_closure.view_all", "cash_closure.close", "cash_closure.export_excel", "cash_closure.create", "cash_closure.history",
        "cartera.view", "cartera.export_excel",
        "calls.view", "calls.create", "calls.manage",
        "loyalty.view", "loyalty.manage_rules", "loyalty.manage_prizes", "loyalty.create_rule", "loyalty.edit_rule", "loyalty.delete_rule", "loyalty.create_prize", "loyalty.edit_prize", "loyalty.delete_prize", "loyalty.redeem",
        "users.view", "users.create", "users.edit", "users.delete", "users.change_password", "users.assign_roles", "users.export_excel", "users.manage",
        "exchanges.view", "exchanges.create", "exchanges.edit", "exchanges.delete", "exchanges.export_excel", "exchanges.reception", "exchanges.delivery", "exchanges.save_with_zero_deposit",
        "wallet.view", "wallet.recharge",
        "wallet_validations.view", "wallet_validations.confirm", "wallet_validations.reject", "wallet_validations.validate",
        "catalogs.view", "catalogs.manage",
        "system_config.view", "system_config.edit_parameters", "system_config.create_notimonchito", "system_config.edit_notimonchito", "system_config.delete_notimonchito",
        "system_settings.view", "system_settings.edit"
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
