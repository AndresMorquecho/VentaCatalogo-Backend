const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const roles = [
        {
            name: 'ADMIN',
            description: 'Acceso total al sistema',
            permissions: [
                'dashboard.view',
                'orders.view', 'orders.create', 'orders.edit', 'orders.delete',
                'reception.view', 'reception.confirm',
                'delivery.view', 'delivery.confirm',
                'clients.view', 'clients.create', 'clients.edit', 'clients.delete',
                'transactions.view',
                'payments.view', 'payments.create', 'payments.delete',
                'bank_accounts.view', 'bank_accounts.create', 'bank_accounts.edit', 'bank_accounts.delete',
                'inventory.view', 'inventory.edit',
                'brands.view', 'brands.create', 'brands.edit', 'brands.delete',
                'cash_closure.view', 'cash_closure.close',
                'calls.view', 'calls.create',
                'loyalty.view', 'loyalty.manage_rules', 'loyalty.manage_prizes',
                'users.view', 'users.create', 'users.edit', 'users.delete', 'users.change_password', 'users.assign_roles',
            ]
        },
        {
            name: 'CAJERA',
            description: 'Gestión de cobros y caja',
            permissions: [
                'dashboard.view',
                'payments.view', 'payments.create',
                'transactions.view',
                'cash_closure.view', 'cash_closure.close',
                'clients.view',
            ]
        },
        {
            name: 'USER',
            description: 'Rol predeterminado (Cajera)',
            permissions: [
                'dashboard.view',
                'payments.view', 'payments.create',
                'transactions.view',
                'cash_closure.view', 'cash_closure.close',
                'clients.view',
            ]
        },
        {
            name: 'SECRETARIA',
            description: 'Apoyo administrativo',
            permissions: [
                'dashboard.view',
                'clients.view',
                'transactions.view',
                'payments.view', 'payments.create',
                'cash_closure.view',
            ]
        }
    ];

    for (const r of roles) {
        await prisma.role.upsert({
            where: { name: r.name },
            update: { permissions: r.permissions },
            create: {
                name: r.name,
                description: r.description,
                permissions: r.permissions,
                isActive: true
            }
        });
    }

    // Re-create some test users since reset deleted them
    const bcrypt = require('bcryptjs');
    const adminPw = await bcrypt.hash('Admin123!', 10);
    await prisma.user.upsert({
        where: { username: 'admin' },
        update: {},
        create: {
            username: 'admin',
            password: adminPw,
            role: 'ADMIN',
            isActive: true
        }
    });

    console.log('Roles and Admin user seeded successfully');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
