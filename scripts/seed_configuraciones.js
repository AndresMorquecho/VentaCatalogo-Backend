const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const orderTypes = [
    { name: 'NORMAL', description: 'Pedido estándar', isSystem: true },
    { name: 'PREVENTA', description: 'Pedido de preventa', isSystem: true },
    { name: 'REPROGRAMACION', description: 'Pedido reprogramado', isSystem: true },
    { name: 'CATALOGO', description: 'Pedido de catálogo', isSystem: true },
    { name: 'CAMBIO', description: 'Cambio de prenda', isSystem: true },
  ];

  const salesChannels = [
    { name: 'OFICINA', description: 'Venta por oficina' },
    { name: 'WHATSAPP', description: 'Venta por WhatsApp' },
    { name: 'DOMICILIO', description: 'Venta a domicilio' },
  ];

  console.log('Seeding order types...');
  for (const type of orderTypes) {
    await prisma.orderType.upsert({
      where: { name: type.name },
      update: {},
      create: type,
    });
  }

  console.log('Seeding sales channels...');
  for (const channel of salesChannels) {
    await prisma.salesChannel.upsert({
      where: { name: channel.name },
      update: {},
      create: channel,
    });
  }

  console.log('Seed completed successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
