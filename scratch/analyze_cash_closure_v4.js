
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyze() {
  try {
    const records = await prisma.financialRecord.findMany({
      where: {
        createdBy: 'JARM',
        date: {
          gte: new Date('2026-04-28T00:00:00Z'),
          lte: new Date('2026-04-28T23:59:59Z')
        }
      },
      select: {
        id: true,
        type: true,
        source: true,
        movementType: true,
        amount: true,
        date: true,
        notes: true
      }
    });

    console.log(`JARM records: ${records.length}`);
    records.forEach(r => {
      console.log(`ID: ${r.id} | Type: ${r.type} | Source: ${r.source} | Move: ${r.movementType} | Notes: ${r.notes}`);
    });

  } catch (error) {
    console.error('Error during analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyze();
