import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function fixValue(val) {
  if (!val) return val;
  let fixed = val.toString().trim();
  
  // Quitar el .0 del final si existe
  if (fixed.endsWith('.0')) {
    fixed = fixed.substring(0, fixed.length - 2);
  }
  
  // Si tiene 9 dígitos, agregar el 0 inicial
  if (fixed.length === 9 && /^\d+$/.test(fixed)) {
    fixed = '0' + fixed;
  }
  
  return fixed;
}

async function runMaintenance(dryRun = true) {
  console.log(`--- INICIANDO MANTENIMIENTO DE DATOS (Modo: ${dryRun ? 'SIMULACIÓN' : 'REAL'}) ---`);
  
  try {
    const clients = await prisma.client.findMany();
    let updatedCount = 0;
    let collisionCount = 0;
    let skippedCount = 0;

    const existingIds = new Set(clients.map(c => c.identificationNumber));

    for (const client of clients) {
      const fixedId = fixValue(client.identificationNumber);
      const fixedPhone = fixValue(client.phone1);
      
      const needsUpdate = (fixedId !== client.identificationNumber || fixedPhone !== client.phone1);

      if (needsUpdate) {
        // Verificar colisión de cédula si cambió
        if (fixedId !== client.identificationNumber && existingIds.has(fixedId)) {
          console.warn(`[COLISIÓN] No se puede arreglar cédula ${client.identificationNumber} -> ${fixedId} porque ya existe. (Cliente: ${client.firstName})`);
          collisionCount++;
          continue;
        }

        if (dryRun) {
          console.log(`[SIMULACIÓN] ID: ${client.identificationNumber} -> ${fixedId} | TEL: ${client.phone1} -> ${fixedPhone} (${client.firstName})`);
          updatedCount++;
        } else {
          await prisma.client.update({
            where: { id: client.id },
            data: {
              identificationNumber: fixedId,
              phone1: fixedPhone,
              lastDataUpdate: new Date()
            }
          });
          updatedCount++;
          // Actualizar nuestro set local para evitar colisiones en la misma ejecución
          existingIds.delete(client.identificationNumber);
          existingIds.add(fixedId);
        }
      } else {
        skippedCount++;
      }
    }

    console.log('\n--- RESULTADO FINAL ---');
    console.log(`Registros procesados: ${clients.length}`);
    console.log(`Registros ${dryRun ? 'que se arreglarían' : 'arreglados'}: ${updatedCount}`);
    console.log(`Colisiones evitadas (requieren revisión manual): ${collisionCount}`);
    console.log(`Registros que ya estaban bien: ${skippedCount}`);

  } catch (error) {
    console.error('Error durante el mantenimiento:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar en modo REAL
runMaintenance(false);
