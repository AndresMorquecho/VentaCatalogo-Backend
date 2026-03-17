const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function addTestWalletCredit() {
  try {
    // Buscar el primer cliente
    const client = await prisma.client.findFirst({
      where: { isBlocked: false }
    });

    if (!client) {
      console.log('No se encontró ningún cliente activo');
      return;
    }

    console.log('Cliente encontrado:', client.firstName, client.identificationNumber);

    // Buscar o crear ClientAccount
    let clientAccount = await prisma.clientAccount.findFirst({
      where: { clientId: client.id }
    });

    if (!clientAccount) {
      clientAccount = await prisma.clientAccount.create({
        data: {
          clientId: client.id,
          totalCredit: 0,
          usedCredit: 0,
          availableCredit: 0
        }
      });
      console.log('ClientAccount creado');
    }

    // Crear un crédito de prueba
    const testCredit = await prisma.clientCredit.create({
      data: {
        clientAccountId: clientAccount.id,
        amount: 150.00,
        remainingAmount: 150.00,
        status: 'AVAILABLE',
        source: 'MANUAL',
        description: 'Crédito de prueba para billetera virtual',
        createdBy: 'test-script'
      }
    });

    console.log('Crédito de prueba creado:', testCredit);
    console.log('Cliente ID:', client.id);
    console.log('Saldo disponible: $150.00');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addTestWalletCredit();