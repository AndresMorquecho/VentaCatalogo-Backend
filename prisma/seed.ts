import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Create admin user
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ventascatalogo.com' },
    update: {},
    create: {
      email: 'admin@ventascatalogo.com',
      password: hashedPassword,
      name: 'Administrador',
      role: 'ADMIN'
    }
  });
  console.log('✅ Admin user created:', admin.email);

  // Create bank accounts
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

  // Create brands
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
    console.log('✅ Brand created:', brand.name);
  }

  // Create sample client
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
  console.log('✅ Sample client created:', client.firstName);

  // Create client account
  await prisma.clientAccount.upsert({
    where: { clientId: client.id },
    update: {},
    create: {
      clientId: client.id
    }
  });
  console.log('✅ Client account created for:', client.firstName);

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
