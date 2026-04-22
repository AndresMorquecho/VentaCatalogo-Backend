const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSessions() {
  const sessions = await prisma.cashSession.findMany({
    where: { status: 'OPEN' },
    orderBy: { openingDate: 'desc' }
  });
  console.log('Open Sessions:', JSON.stringify(sessions, null, 2));

  const lastClosed = await prisma.cashSession.findFirst({
    where: { status: 'CLOSED' },
    orderBy: { closingDate: 'desc' }
  });
  console.log('Last Closed Session:', JSON.stringify(lastClosed, null, 2));
}

checkSessions()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
