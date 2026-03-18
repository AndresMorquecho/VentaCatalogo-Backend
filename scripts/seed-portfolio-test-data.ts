/**
 * Script para insertar datos de prueba para el módulo de Portfolio Recovery
 * 
 * Este script crea:
 * - Órdenes con diferentes fechas de recepción (últimas 8 semanas)
 * - Pagos parciales para simular diferentes tasas de recuperación
 * - Múltiples marcas con diferentes niveles de recuperación
 * 
 * Uso: npx ts-node scripts/seed-portfolio-test-data.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Configuración
const WEEKS_TO_GENERATE = 8;
const ORDERS_PER_WEEK = 5;

// Marcas de prueba con diferentes tasas de recuperación objetivo
const TEST_BRANDS = [
  { name: 'Marca Saludable A', targetRecoveryRate: 0.75 }, // 75% recuperación
  { name: 'Marca Saludable B', targetRecoveryRate: 0.80 }, // 80% recuperación
  { name: 'Marca Advertencia A', targetRecoveryRate: 0.45 }, // 45% recuperación
  { name: 'Marca Advertencia B', targetRecoveryRate: 0.35 }, // 35% recuperación
  { name: 'Marca Crítica A', targetRecoveryRate: 0.20 }, // 20% recuperación
  { name: 'Marca Crítica B', targetRecoveryRate: 0.15 }, // 15% recuperación
];

async function main() {
  console.log('🚀 Iniciando seed de datos de prueba para Portfolio Recovery...\n');

  // 1. Obtener o crear cliente de prueba
  console.log('📋 Verificando cliente de prueba...');
  let testClient = await prisma.client.findFirst({
    where: { identificationNumber: 'TEST-PORTFOLIO-001' }
  });

  if (!testClient) {
    testClient = await prisma.client.create({
      data: {
        identificationType: 'CEDULA',
        identificationNumber: 'TEST-PORTFOLIO-001',
        firstName: 'Cliente Portfolio Test',
        country: 'República Dominicana',
        province: 'Santo Domingo',
        city: 'Santo Domingo',
        address: 'Calle Test 123',
        email: 'portfolio-test@example.com',
        phone1: '8091234567',
        operator1: 'CLARO',
        createdByName: 'SYSTEM',
      }
    });
    console.log('✅ Cliente de prueba creado');
  } else {
    console.log('✅ Cliente de prueba encontrado');
  }

  // 2. Obtener o crear cuenta bancaria de prueba
  console.log('💰 Verificando cuenta bancaria de prueba...');
  let testBankAccount = await prisma.bankAccount.findFirst({
    where: { accountNumber: 'TEST-PORTFOLIO-CASH' }
  });

  if (!testBankAccount) {
    testBankAccount = await prisma.bankAccount.create({
      data: {
        name: 'Caja Portfolio Test',
        type: 'CASH',
        holderName: 'Sistema',
        bankName: 'N/A',
        accountNumber: 'TEST-PORTFOLIO-CASH',
        currentBalance: 0,
      }
    });
    console.log('✅ Cuenta bancaria de prueba creada');
  } else {
    console.log('✅ Cuenta bancaria de prueba encontrada');
  }

  // 3. Crear o verificar marcas de prueba
  console.log('\n🏷️  Creando marcas de prueba...');
  const brands = [];
  for (const brandConfig of TEST_BRANDS) {
    let brand = await prisma.brand.findFirst({
      where: { name: brandConfig.name }
    });

    if (!brand) {
      brand = await prisma.brand.create({
        data: {
          name: brandConfig.name,
          description: `Marca de prueba con tasa objetivo de ${(brandConfig.targetRecoveryRate * 100).toFixed(0)}%`,
        }
      });
      console.log(`  ✅ Marca creada: ${brand.name}`);
    } else {
      console.log(`  ✅ Marca encontrada: ${brand.name}`);
    }
    brands.push({ ...brand, targetRecoveryRate: brandConfig.targetRecoveryRate });
  }

  // 4. Generar órdenes con diferentes fechas de recepción
  console.log('\n📦 Generando órdenes con diferentes fechas...');
  const today = new Date();
  let totalOrders = 0;
  let totalPayments = 0;

  for (let week = 0; week < WEEKS_TO_GENERATE; week++) {
    // Calcular fecha de recepción (retroceder semanas desde hoy)
    const receptionDate = new Date(today);
    receptionDate.setDate(today.getDate() - (week * 7));
    
    console.log(`\n  📅 Semana ${week + 1} (${receptionDate.toISOString().split('T')[0]}):`);

    for (let orderNum = 0; orderNum < ORDERS_PER_WEEK; orderNum++) {
      // Seleccionar marca aleatoria
      const brand = brands[Math.floor(Math.random() * brands.length)];
      
      // Generar monto aleatorio entre $100 y $1000
      const orderTotal = Math.floor(Math.random() * 900) + 100;
      
      // Calcular monto a pagar basado en la tasa objetivo de la marca (con variación)
      const variation = (Math.random() * 0.2) - 0.1; // ±10% de variación
      const actualRecoveryRate = Math.max(0, Math.min(1, brand.targetRecoveryRate + variation));
      const paidAmount = Math.floor(orderTotal * actualRecoveryRate);

      // Crear recibo
      const receiptNumber = `TEST-REC-${week}-${orderNum}-${Date.now()}`;
      const receipt = await prisma.orderReceipt.create({
        data: {
          receiptNumber,
          clientId: testClient.id,
          clientName: testClient.firstName,
          salesChannel: 'OFICINA',
          transactionDate: receptionDate,
          paymentMethod: 'EFECTIVO',
          bankAccountId: testBankAccount.id,
          createdByName: 'SYSTEM',
        }
      });

      // Crear orden
      const order = await prisma.order.create({
        data: {
          receiptNumber,
          receiptId: receipt.id,
          salesChannel: 'OFICINA',
          type: 'NORMAL',
          brandId: brand.id,
          total: orderTotal,
          paymentMethod: 'EFECTIVO',
          bankAccountId: testBankAccount.id,
          transactionDate: receptionDate,
          possibleDeliveryDate: new Date(receptionDate.getTime() + 7 * 24 * 60 * 60 * 1000), // +7 días
          receptionDate: receptionDate,
          status: 'RECIBIDO_EN_BODEGA',
          clientId: testClient.id,
          clientName: testClient.firstName,
          createdByName: 'SYSTEM',
          receivedByName: 'SYSTEM',
        }
      });

      totalOrders++;

      // Crear pagos si hay monto recuperado
      if (paidAmount > 0) {
        // Dividir el pago en 1-3 pagos parciales
        const numPayments = Math.floor(Math.random() * 3) + 1;
        let remainingAmount = paidAmount;

        for (let p = 0; p < numPayments && remainingAmount > 0; p++) {
          const isLastPayment = p === numPayments - 1;
          const paymentAmount = isLastPayment 
            ? remainingAmount 
            : Math.floor(remainingAmount / (numPayments - p) * (0.8 + Math.random() * 0.4));

          await prisma.orderPayment.create({
            data: {
              orderId: order.id,
              amount: paymentAmount,
              method: 'EFECTIVO',
              receiptNumber: `PAY-${order.id.substring(0, 8)}-${p + 1}`,
              description: `Pago ${p + 1} de ${numPayments}`,
            }
          });

          remainingAmount -= paymentAmount;
          totalPayments++;
        }
      }

      console.log(`    ✅ Orden ${orderNum + 1}: ${brand.name} - $${orderTotal} (Pagado: $${paidAmount} - ${(actualRecoveryRate * 100).toFixed(0)}%)`);
    }
  }

  console.log(`\n✨ Seed completado exitosamente!`);
  console.log(`   📦 Total órdenes creadas: ${totalOrders}`);
  console.log(`   💵 Total pagos creados: ${totalPayments}`);
  console.log(`   🏷️  Marcas: ${brands.length}`);
  console.log(`   📅 Período: ${WEEKS_TO_GENERATE} semanas\n`);
}

main()
  .catch((e) => {
    console.error('❌ Error durante el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
