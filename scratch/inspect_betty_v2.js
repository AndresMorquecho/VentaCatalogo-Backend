const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Buscando por cedula exacta: 924920820');
  const client1 = await prisma.client.findFirst({
    where: { identificationNumber: '924920820' }
  });
  
  console.log('Buscando por cedula con cero: 0924920820');
  const client2 = await prisma.client.findFirst({
    where: { identificationNumber: '0924920820' }
  });

  console.log('Buscando por parte del nombre: JACQUELINE');
  const client3 = await prisma.client.findFirst({
    where: { firstName: { contains: 'JACQUELINE', mode: 'insensitive' } }
  });

  console.log('RESULTADOS:');
  console.log('Con 924920820:', client1 ? 'ENCONTRADO' : 'NO');
  console.log('Con 0924920820:', client2 ? 'ENCONTRADO' : 'NO');
  console.log('Con JACQUELINE:', client3 ? client3.firstName : 'NO');
  
  if (client1 || client2 || client3) {
      console.log('Detalle del encontrado:', JSON.stringify(client1 || client2 || client3, null, 2));
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
