
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyze() {
  try {
    console.log('--- ANALYZING CASH CLOSURES ---');
    const closures = await prisma.cashClosure.findMany({
      orderBy: { toDate: 'desc' },
      take: 5
    });

    console.log(`Found ${closures.length} recent closures.`);
    closures.forEach(c => {
      console.log(`ID: ${c.id} | From: ${c.fromDate.toISOString()} | To: ${c.toDate.toISOString()} | Closed By: ${c.closedBy}`);
    });

    console.log('\n--- ANALYZING JARM RECORDS ---');
    const jarmRecords = await prisma.financialRecord.findMany({
      where: {
        createdBy: 'JARM',
        date: {
          gte: new Date('2026-04-28T00:00:00Z'),
          lte: new Date('2026-04-28T23:59:59Z')
        }
      }
    });
    console.log(`User JARM has ${jarmRecords.length} records on 2026-04-28.`);
    jarmRecords.forEach(r => {
      console.log(`  Date: ${r.date.toISOString()} | Amount: ${r.amount} | ID: ${r.id}`);
    });

  } catch (error) {
    console.error('Error during analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyze();
