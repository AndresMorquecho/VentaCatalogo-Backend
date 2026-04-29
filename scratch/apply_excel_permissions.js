
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('--- ACTUALIZANDO PERMISOS MAESTROS DE ADMINISTRADOR ---');
    
    const allPermissions = [
        "dashboard.view",
        "orders.view", "orders.create", "orders.edit", "orders.delete", "orders.export_excel",
        "reception.view", "reception.confirm", "reception.export_excel",
        "delivery.view", "delivery.confirm", "delivery.export_excel",
        "clients.view", "clients.create", "clients.edit", "clients.delete", "clients.export_excel",
        "transactions.view", "transactions.export_excel",
        "payments.view", "payments.create", "payments.delete", "payments.export_excel",
        "bank_accounts.view", "bank_accounts.create", "bank_accounts.edit", "bank_accounts.delete",
        "inventory.view", "inventory.edit", "inventory.export_excel",
        "brands.view", "brands.create", "brands.edit", "brands.delete",
        "cash_closure.view", "cash_closure.view_all", "cash_closure.close", "cash_closure.export_excel",
        "cartera.view", "cartera.export_excel",
        "calls.view", "calls.create",
        "loyalty.view", "loyalty.manage_rules", "loyalty.manage_prizes",
        "users.view", "users.create", "users.edit", "users.delete", "users.change_password", "users.assign_roles", "users.export_excel",
        "exchanges.view", "exchanges.create", "exchanges.edit", "exchanges.delete", "exchanges.export_excel"
    ];

    // Buscar el rol ADMIN
    const adminRole = await prisma.role.findUnique({
      where: { name: 'ADMIN' }
    });

    if (!adminRole) {
      console.error('No se encontró el rol ADMIN.');
      return;
    }

    console.log(`Actualizando rol ADMIN con ${allPermissions.length} permisos...`);
    
    await prisma.role.update({
      where: { name: 'ADMIN' },
      data: { 
        permissions: allPermissions,
        description: 'Control Total del Sistema (Incluye Exportación Excel)'
      }
    });

    console.log('Actualización completada exitosamente.');

  } catch (error) {
    console.error('Error durante la actualización:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
