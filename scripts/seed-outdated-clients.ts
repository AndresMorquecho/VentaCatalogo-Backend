/**
 * Seed script: 3 empresarias con lastDataUpdate > 3 meses
 * Uso: npx ts-node scripts/seed-outdated-clients.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Fecha de hace 4 meses (bien pasados los 3 meses)
  const fourMonthsAgo = new Date();
  fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);

  const fiveMonthsAgo = new Date();
  fiveMonthsAgo.setMonth(fiveMonthsAgo.getMonth() - 5);

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const clients = [
    {
      identificationType: 'CEDULA',
      identificationNumber: 'TEST-001-SEED',
      firstName: 'MARIA TEST DESACTUALIZADA',
      country: 'Ecuador',
      province: 'Pichincha',
      city: 'Quito',
      address: 'Av. Test 123',
      neighborhood: 'El Batán',
      email: 'maria.test@demo.com',
      phone1: '0990000001',
      operator1: 'CLARO',
      isActive: true,
      lastDataUpdate: fourMonthsAgo,
      createdByName: 'SEED_SCRIPT',
    },
    {
      identificationType: 'CEDULA',
      identificationNumber: 'TEST-002-SEED',
      firstName: 'ANA TEST DESACTUALIZADA',
      country: 'Ecuador',
      province: 'Pichincha',
      city: 'Quito',
      address: 'Calle Test 456',
      neighborhood: 'La Carolina',
      email: 'ana.test@demo.com',
      phone1: '0990000002',
      operator1: 'MOVISTAR',
      isActive: true,
      lastDataUpdate: fiveMonthsAgo,
      createdByName: 'SEED_SCRIPT',
    },
    {
      identificationType: 'CEDULA',
      identificationNumber: 'TEST-003-SEED',
      firstName: 'LUCIA TEST DESACTUALIZADA',
      country: 'Ecuador',
      province: 'Pichincha',
      city: 'Quito',
      address: 'Transversal Test 789',
      neighborhood: 'Cotocollao',
      email: 'lucia.test@demo.com',
      phone1: '0990000003',
      operator1: 'CNT',
      isActive: true,
      lastDataUpdate: sixMonthsAgo,
      createdByName: 'SEED_SCRIPT',
    },
  ];

  console.log('🌱 Insertando 3 empresarias con datos desactualizados...\n');

  for (const client of clients) {
    const existing = await prisma.client.findUnique({
      where: { identificationNumber: client.identificationNumber },
    });

    if (existing) {
      // Actualizar la fecha de lastDataUpdate para que sea > 3 meses
      const updated = await prisma.client.update({
        where: { identificationNumber: client.identificationNumber },
        data: { lastDataUpdate: client.lastDataUpdate },
      });
      console.log(
        `✅ Actualizado: ${updated.firstName} — lastDataUpdate: ${updated.lastDataUpdate.toLocaleDateString('es-EC')}`
      );
    } else {
      const created = await prisma.client.create({ data: client });
      console.log(
        `✅ Creado: ${created.firstName} — lastDataUpdate: ${created.lastDataUpdate.toLocaleDateString('es-EC')}`
      );
    }
  }

  console.log('\n🎉 Seed completado. Abre la sección "Empresarias" para ver la alerta.');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
