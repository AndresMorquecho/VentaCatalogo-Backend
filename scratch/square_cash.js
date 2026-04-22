const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const Decimal = require('decimal.js');

async function squareCash() {
  console.log('--- Iniciando cuadre de caja ---');
  
  // 1. Obtener Caja Principal
  const caja = await prisma.bankAccount.findFirst({
    where: { name: 'Caja Principal' }
  });
  
  if (!caja) {
    console.error('No se encontró la Caja Principal');
    return;
  }

  const currentBalance = new Decimal(caja.currentBalance.toString());
  console.log(`Balance actual en Caja Principal: ${currentBalance}`);

  if (currentBalance.isZero()) {
    console.log('El balance ya es 0. No hay nada que cuadrar.');
  } else {
    // 2. Crear un registro financiero de ajuste para llevar la caja a 0
    // Esto es necesario para que el sistema de cierre de caja vea el movimiento
    const now = new Date();
    // Usamos una fecha de ayer para el ajuste si queremos que hoy empiece en 0
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);

    console.log(`Creando ajuste de egreso por ${currentBalance} con fecha ${yesterday.toISOString()}...`);
    
    await prisma.financialRecord.create({
      data: {
        type: 'EXPENSE',
        referenceNumber: `ADJ-HIST-${Date.now()}`,
        amount: currentBalance,
        date: yesterday,
        clientId: 'system-client-id', // Necesitamos un cliente para el registro financiero, usaremos uno genérico o el primero
        clientName: 'AJUSTE HISTORICO',
        createdBy: 'SISTEMA',
        notes: 'Ajuste para iniciar hoy desde 0 tras migración',
        bankAccountId: caja.id,
        source: 'ADJUSTMENT',
        movementType: 'EXPENSE',
        version: 1
      }
    });

    // 3. Actualizar el balance del banco manualmente (aunque el sistema suele tener triggers o hooks, lo aseguramos)
    await prisma.bankAccount.update({
      where: { id: caja.id },
      data: { 
        currentBalance: 0,
        updatedAt: now
      }
    });
    
    console.log('Balance de Caja Principal actualizado a 0.');
  }

  // 4. Crear el cierre de caja para cerrar el periodo hasta ayer
  // Buscamos el último cierre
  const lastClosure = await prisma.cashClosure.findFirst({
    orderBy: { toDate: 'desc' }
  });

  const fromDate = lastClosure ? new Date(lastClosure.toDate.getTime() + 1) : new Date(0);
  const toDate = new Date();
  // El usuario quiere empezar HOY desde 0. Así que cerramos hasta este momento exacto.
  
  console.log(`Creando cierre de caja desde ${fromDate.toISOString()} hasta ${toDate.toISOString()}...`);

  // Para el cierre real, usaríamos el usecase, pero aquí lo haremos manual para asegurar que cuadre a 0
  await prisma.cashClosure.create({
    data: {
      fromDate,
      toDate,
      notes: 'Cierre de ajuste para inicio de operaciones limpias tras migración',
      totalIncome: 0,
      totalExpense: currentBalance,
      expectedAmount: 0,
      actualAmount: 0,
      difference: 0,
      movementCount: 1,
      closedBy: 'SISTEMA',
      closedAt: new Date(),
      detailedReport: { info: 'Cierre forzado a 0' }
    }
  });

  console.log('Cierre de caja completado. Hoy empieza desde 0.');
}

// Necesitamos asegurar que existe un cliente "sistema" o similar para el FinancialRecord
async function ensureSystemClient() {
    const client = await prisma.client.findFirst({ where: { identificationNumber: '9999999999' } });
    if (!client) {
        return await prisma.client.create({
            data: {
                id: 'system-client-id',
                identificationType: 'OTRO',
                identificationNumber: '9999999999',
                firstName: 'SISTEMA',
                country: 'ECUADOR',
                province: 'PICHINCHA',
                city: 'QUITO',
                address: 'SISTEMA',
                email: 'sistema@monchito.com',
                phone1: '0000000000',
                operator1: 'OTRO',
                isActive: true
            }
        });
    }
    return client;
}

ensureSystemClient()
  .then(() => squareCash())
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
