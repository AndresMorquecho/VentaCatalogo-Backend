const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const client = await prisma.client.findFirst({
    where: { 
      OR: [
        { identificationNumber: '924920820' },
        { firstName: { contains: 'BETTY', mode: 'insensitive' } }
      ]
    }
  });
  
  if (client) {
    console.log('CLIENTE ENCONTRADO:');
    console.log(JSON.stringify(client, null, 2));
  } else {
    console.log('CLIENTE NO ENCONTRADO POR CEDULA NI NOMBRE');
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
