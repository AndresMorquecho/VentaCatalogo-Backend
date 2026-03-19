/**
 * Script para poblar la base de datos con datos realistas
 * - 20 Clientes (empresarias) con nombres reales
 * - 20 Marcas de catálogos reales
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Datos realistas de clientes/empresarias
const CLIENTS_DATA = [
  { firstName: 'María González', email: 'maria.gonzalez@email.com', phone: '0998765432', operator: 'CLARO', city: 'Quito', province: 'Pichincha', cedula: '1712345678' },
  { firstName: 'Ana Rodríguez', email: 'ana.rodriguez@email.com', phone: '0987654321', operator: 'MOVISTAR', city: 'Guayaquil', province: 'Guayas', cedula: '0912345678' },
  { firstName: 'Carmen López', email: 'carmen.lopez@email.com', phone: '0976543210', operator: 'CNT', city: 'Cuenca', province: 'Azuay', cedula: '0112345678' },
  { firstName: 'Rosa Martínez', email: 'rosa.martinez@email.com', phone: '0965432109', operator: 'CLARO', city: 'Ambato', province: 'Tungurahua', cedula: '1812345678' },
  { firstName: 'Patricia Sánchez', email: 'patricia.sanchez@email.com', phone: '0954321098', operator: 'MOVISTAR', city: 'Manta', province: 'Manabí', cedula: '1312345678' },
  { firstName: 'Laura Ramírez', email: 'laura.ramirez@email.com', phone: '0943210987', operator: 'CLARO', city: 'Machala', province: 'El Oro', cedula: '0712345678' },
  { firstName: 'Isabel Torres', email: 'isabel.torres@email.com', phone: '0932109876', operator: 'CNT', city: 'Loja', province: 'Loja', cedula: '1112345678' },
  { firstName: 'Gabriela Flores', email: 'gabriela.flores@email.com', phone: '0921098765', operator: 'MOVISTAR', city: 'Riobamba', province: 'Chimborazo', cedula: '0612345678' },
  { firstName: 'Verónica Castro', email: 'veronica.castro@email.com', phone: '0910987654', operator: 'CLARO', city: 'Ibarra', province: 'Imbabura', cedula: '1012345678' },
  { firstName: 'Silvia Morales', email: 'silvia.morales@email.com', phone: '0909876543', operator: 'MOVISTAR', city: 'Esmeraldas', province: 'Esmeraldas', cedula: '0812345678' },
  { firstName: 'Diana Ortiz', email: 'diana.ortiz@email.com', phone: '0998765433', operator: 'CNT', city: 'Santo Domingo', province: 'Santo Domingo', cedula: '2312345678' },
  { firstName: 'Mónica Herrera', email: 'monica.herrera@email.com', phone: '0987654322', operator: 'CLARO', city: 'Portoviejo', province: 'Manabí', cedula: '1312345679' },
  { firstName: 'Andrea Vargas', email: 'andrea.vargas@email.com', phone: '0976543211', operator: 'MOVISTAR', city: 'Quevedo', province: 'Los Ríos', cedula: '1212345678' },
  { firstName: 'Cristina Mendoza', email: 'cristina.mendoza@email.com', phone: '0965432110', operator: 'CLARO', city: 'Latacunga', province: 'Cotopaxi', cedula: '0512345678' },
  { firstName: 'Lucía Jiménez', email: 'lucia.jimenez@email.com', phone: '0954321099', operator: 'CNT', city: 'Tulcán', province: 'Carchi', cedula: '0412345678' },
  { firstName: 'Fernanda Ruiz', email: 'fernanda.ruiz@email.com', phone: '0943210988', operator: 'MOVISTAR', city: 'Babahoyo', province: 'Los Ríos', cedula: '1212345679' },
  { firstName: 'Paola Díaz', email: 'paola.diaz@email.com', phone: '0932109877', operator: 'CLARO', city: 'Milagro', province: 'Guayas', cedula: '0912345679' },
  { firstName: 'Daniela Peña', email: 'daniela.pena@email.com', phone: '0921098766', operator: 'MOVISTAR', city: 'Durán', province: 'Guayas', cedula: '0912345680' },
  { firstName: 'Carolina Vega', email: 'carolina.vega@email.com', phone: '0910987655', operator: 'CNT', city: 'Salinas', province: 'Santa Elena', cedula: '2412345678' },
  { firstName: 'Sofía Romero', email: 'sofia.romero@email.com', phone: '0909876544', operator: 'CLARO', city: 'Sangolquí', province: 'Pichincha', cedula: '1712345679' },
];

// Marcas reales de catálogos de venta directa
const BRANDS_DATA = [
  { name: 'Avon', description: 'Cosméticos y productos de belleza' },
  { name: 'Yanbal', description: 'Cosméticos y fragancias' },
  { name: 'Esika', description: 'Maquillaje y cuidado personal' },
  { name: 'Cyzone', description: 'Cosméticos para jóvenes' },
  { name: 'Natura', description: 'Cosméticos naturales' },
  { name: 'Oriflame', description: 'Productos de belleza' },
  { name: 'Mary Kay', description: 'Cuidado de la piel y maquillaje' },
  { name: 'Herbalife', description: 'Nutrición y bienestar' },
  { name: 'Tupperware', description: 'Productos para el hogar' },
  { name: 'Leonisa', description: 'Ropa interior y fajas' },
  { name: 'Belcorp', description: 'Cosméticos y fragancias' },
  { name: 'Jafra', description: 'Cuidado de la piel' },
  { name: 'Amway', description: 'Productos para el hogar y nutrición' },
  { name: 'Forever Living', description: 'Productos de aloe vera' },
  { name: 'Omnilife', description: 'Suplementos nutricionales' },
  { name: 'Nikken', description: 'Bienestar y salud' },
  { name: 'Vorwerk', description: 'Electrodomésticos' },
  { name: 'Thermomix', description: 'Robot de cocina' },
  { name: 'Pampered Chef', description: 'Utensilios de cocina' },
  { name: 'Scentsy', description: 'Fragancias para el hogar' },
];

async function main() {
  console.log('🌱 Iniciando seed de datos realistas...\n');

  try {
    // 1. Crear Marcas
    console.log('📦 Creando 20 marcas...');
    const brands = [];
    for (const brandData of BRANDS_DATA) {
      const brand = await prisma.brand.upsert({
        where: { name: brandData.name },
        update: {},
        create: {
          name: brandData.name,
          description: brandData.description,
          isActive: true,
        },
      });
      brands.push(brand);
      console.log(`  ✓ ${brand.name}`);
    }
    console.log(`✅ ${brands.length} marcas creadas\n`);

    // 2. Crear Clientes/Empresarias
    console.log('👥 Creando 20 clientes/empresarias...');
    const clients = [];
    for (const clientData of CLIENTS_DATA) {
      const client = await prisma.client.upsert({
        where: { identificationNumber: clientData.cedula },
        update: {},
        create: {
          identificationType: 'CEDULA',
          identificationNumber: clientData.cedula,
          firstName: clientData.firstName,
          email: clientData.email,
          phone1: clientData.phone,
          operator1: clientData.operator,
          isWhatsApp: Math.random() > 0.3, // 70% tienen WhatsApp
          city: clientData.city,
          province: clientData.province,
          country: 'Ecuador',
          address: `Calle Principal y Secundaria, ${clientData.city}`,
          isActive: true,
          isBlocked: false,
        },
      });
      clients.push(client);
      console.log(`  ✓ ${client.firstName} - ${client.city}`);
    }
    console.log(`✅ ${clients.length} clientes creados\n`);

    // Resumen
    console.log('============================================');
    console.log('✅ SEED COMPLETADO EXITOSAMENTE');
    console.log('============================================');
    console.log(`📦 Marcas: ${brands.length}`);
    console.log(`👥 Clientes: ${clients.length}`);
    console.log('============================================\n');

  } catch (error) {
    console.error('❌ Error durante el seed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
