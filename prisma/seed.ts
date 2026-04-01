import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // 1. CREAR ROLES Y PERMISOS (Vital para el nuevo sistema RBAC)
  const allPermissions = [
    "dashboard.view",
    "orders.view", "orders.create", "orders.edit", "orders.delete", "orders.save_with_zero_deposit",
    "reception.view", "reception.finalize", "reception.edit", "reception.delete",
    "delivery.view", "delivery.dismantle", "delivery.return",
    "clients.view", "clients.create", "clients.edit", "clients.delete", "clients.update_data",
    "transactions.view",
    "payments.view", "payments.create", "payments.delete",
    "wallet.view",
    "wallet_validations.view", "wallet_validations.confirm", "wallet_validations.reject",
    "bank_accounts.view", "bank_accounts.manage",
    "inventory.view", "inventory.manage",
    "brands.view", "brands.manage",
    "catalogs.view", "catalogs.manage",
    "cash_closure.view", "cash_closure.create", "cash_closure.history",
    "cartera.view",
    "calls.view", "calls.manage",
    "loyalty.view", "loyalty.create_rule", "loyalty.edit_rule", "loyalty.delete_rule", "loyalty.create_prize", "loyalty.edit_prize", "loyalty.delete_prize",
    "exchanges.view", "exchanges.create", "exchanges.reception", "exchanges.delivery",
    "users.view", "users.manage",
    "system_config.view", "system_config.edit_parameters", "system_config.create_notimonchito", "system_config.edit_notimonchito", "system_config.delete_notimonchito"
  ];

  console.log('Creating Roles...');
  const roles = [
    { 
      name: 'ADMIN', 
      description: 'Control Total del Sistema', 
      permissions: allPermissions 
    },
    { 
      name: 'CAJERA', 
      description: 'Gestión operativa de cobros y pedidos', 
      permissions: [
        "dashboard.view", 
        "orders.view", "orders.create", "orders.edit",
        "clients.view", "clients.create", "clients.edit",
        "payments.view", "payments.create",
        "cash_closure.view", "cash_closure.create", "cash_closure.history",
        "wallet.view", "cartera.view"
      ] 
    },
    { 
      name: 'USER', 
      description: 'Acceso básico de consulta', 
      permissions: ["dashboard.view", "orders.view", "clients.view", "wallet.view"] 
    }
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { 
        permissions: role.permissions,
        description: role.description
      },
      create: role
    });
    console.log(`✅ Role ready: ${role.name}`);
  }

  // 2. CREAR USUARIOS DE PRUEBA
  const hashedPassword = await bcrypt.hash('Admin123!', 10);
  
  // Admin central
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { role: 'ADMIN' },
    create: {
      username: 'admin',
      password: hashedPassword,
      role: 'ADMIN',
      isActive: true
    }
  });
  console.log('✅ Admin user created:', admin.username);

  // Cajera de prueba para el script check-cajera.js
  await prisma.user.upsert({
    where: { username: 'cajera1' },
    update: { role: 'CAJERA' },
    create: {
      username: 'cajera1',
      password: hashedPassword,
      role: 'CAJERA',
      isActive: true
    }
  });

  // 3. CUENTAS BANCARIAS
  const cashAccount = await prisma.bankAccount.upsert({
    where: { id: 'cash-account-1' },
    update: {},
    create: {
      id: 'cash-account-1',
      name: 'Caja Principal',
      type: 'CASH',
      holderName: 'VentasCatalogo',
      bankName: 'Efectivo',
      accountNumber: 'CASH-001',
      currentBalance: 0
    }
  });
  console.log('✅ Cash account created:', cashAccount.name);

  const bankAccount = await prisma.bankAccount.upsert({
    where: { id: 'bank-account-1' },
    update: {},
    create: {
      id: 'bank-account-1',
      name: 'Banco Pichincha',
      type: 'BANK',
      holderName: 'VentasCatalogo',
      bankName: 'Banco Pichincha',
      accountNumber: '1234567890',
      currentBalance: 0
    }
  });
  console.log('✅ Bank account created:', bankAccount.name);

  // 4. MARCAS
  const brands = [
    { name: 'Nike', description: 'Ropa y calzado deportivo' },
    { name: 'Adidas', description: 'Ropa y accesorios deportivos' },
    { name: 'Puma', description: 'Calzado y ropa deportiva' }
  ];

  for (const brand of brands) {
    await prisma.brand.upsert({
      where: { name: brand.name },
      update: {},
      create: brand
    });
    console.log('✅ Brand ready:', brand.name);
  }

  // 5. REGLAS DE LEALTAD (Para el módulo de Héctor)
  console.log('Seeding Loyalty Rules...');
  const loyaltyRules = [
    { name: 'Puntos por Monto', type: 'POR_MONTO', pointsValue: 1, targetValue: 10, isActive: true, condition: '1 punto por cada $10 de compra' },
    { name: 'Bono por primer pedido', type: 'POR_PEDIDO', pointsValue: 10, targetValue: 1, isActive: true }
  ];

  for (const rule of loyaltyRules) {
    await prisma.loyaltyRule.upsert({
      where: { id: rule.name.toLowerCase().replace(/ /g, '-') },
      update: {},
      create: {
        id: rule.name.toLowerCase().replace(/ /g, '-'),
        ...rule
      }
    });
  }

  // 6. CLIENTE DE PRUEBA Y SU CUENTA
  const client = await prisma.client.upsert({
    where: { identificationNumber: '1234567890' },
    update: {},
    create: {
      identificationType: 'CEDULA',
      identificationNumber: '1234567890',
      firstName: 'Juan Pérez',
      country: 'Ecuador',
      province: 'Pichincha',
      city: 'Quito',
      address: 'Av. Principal 123',
      neighborhood: 'Centro',
      email: 'juan.perez@example.com',
      phone1: '0987654321',
      operator1: 'Claro'
    }
  });

  await prisma.clientAccount.upsert({
    where: { clientId: client.id },
    update: {},
    create: {
      clientId: client.id,
      totalCreditAvailable: 0,
      totalRewardPoints: 0
    }
  });
  console.log('✅ Sample client account ready for:', client.firstName);

  console.log('🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

