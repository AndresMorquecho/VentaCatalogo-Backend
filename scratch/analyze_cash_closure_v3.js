
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyze() {
  try {
    const jarmRecords = await prisma.financialRecord.findMany({
      where: {
        createdBy: 'JARM',
        date: {
          gte: new Date('2026-04-28T00:00:00Z'),
          lte: new Date('2026-04-28T23:59:59Z')
        }
      },
      include: {
        bankAccount: true
      }
    });

    console.log(`JARM records: ${jarmRecords.length}`);
    jarmRecords.forEach(r => {
      console.log(`ID: ${r.id} | Account: ${r.bankAccount ? r.bankAccount.name : 'NULL'} | Active: ${r.bankAccount ? r.bankAccount.isActive : 'N/A'}`);
    });

    const activeAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } });
    console.log(`Active accounts count: ${activeAccounts.length}`);
    activeAccounts.forEach(a => console.log(` - ${a.name} (${a.id})`));

  } catch (error) {
    console.error('Error during analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyze();
