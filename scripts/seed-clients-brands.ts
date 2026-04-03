import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando carga de 10 clientes y 10 marcas...');

  // 1. Crear 10 Marcas
  const brandNames = [
    'Avon', 'Yanbal', 'Esika', 'Cyzone', 'Natura', 
    'Oriflame', 'Mary Kay', 'Leonisa', 'Tupperware', 'Belcorp'
  ];

  console.log('📦 Creando marcas...');
  for (const name of brandNames) {
    await prisma.brand.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `Productos de catálogo de ${name}`,
        isActive: true
      }
    });
    console.log(`  ✓ Marca: ${name}`);
  }

  // 2. Crear 10 Clientes (Empresarias)
  const clientsData = [
    { firstName: 'MARIA GARCIA', idNum: '1712345601', city: 'QUITO' },
    { firstName: 'ANA LOPEZ', idNum: '0912345602', city: 'GUAYAQUIL' },
    { firstName: 'CARMEN RODRIGUEZ', idNum: '0112345603', city: 'CUENCA' },
    { firstName: 'ROSA MARTINEZ', idNum: '1812345604', city: 'AMBATO' },
    { firstName: 'PATRICIA SANCHEZ', idNum: '1312345605', city: 'MANTA' },
    { firstName: 'LAURA RAMIREZ', idNum: '0712345606', city: 'MACHALA' },
    { firstName: 'ISABEL TORRES', idNum: '1112345607', city: 'LOJA' },
    { firstName: 'GABRIELA FLORES', idNum: '0612345608', city: 'RIOBAMBA' },
    { firstName: 'VERONICA CASTRO', idNum: '1012345609', city: 'IBARRA' },
    { firstName: 'SILVIA MORALES', idNum: '0812345610', city: 'ESMERALDAS' }
  ];

  console.log('👥 Creando clientes...');
  for (const client of clientsData) {
    const created = await prisma.client.upsert({
      where: { identificationNumber: client.idNum },
      update: {},
      create: {
        identificationType: 'CEDULA',
        identificationNumber: client.idNum,
        firstName: client.firstName,
        email: `${client.firstName.toLowerCase().replace(' ', '.')}@example.com`,
        phone1: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
        operator1: 'CLARO',
        country: 'ECUADOR',
        province: 'PICHINCHA',
        city: client.city,
        address: 'CALLE PRINCIPAL Y SECUNDARIA',
        isActive: true,
        isWhatsApp: true
      }
    });

    // Crear cuenta del cliente (necesario para el sistema)
    await prisma.clientAccount.upsert({
       where: { clientId: created.id },
       update: {},
       create: {
           clientId: created.id,
           totalCreditAvailable: 0,
           totalRewardPoints: 0
       }
    });
    
    console.log(`  ✓ Cliente: ${client.firstName}`);
  }

  console.log('\n✅ Carga completada exitosamente.');
  console.log('Total Marcas: 10');
  console.log('Total Clientes: 10');
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
