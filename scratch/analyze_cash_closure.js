
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyze() {
  try {
    const targetDate = '2026-04-28';
    console.log(`--- ANALYZING FINANCIAL RECORDS FOR ${targetDate} ---`);
    
    // Check records on that specific day
    const records = await prisma.financialRecord.findMany({
      where: {
        date: {
          gte: new Date(targetDate + 'T00:00:00Z'),
          lte: new Date(targetDate + 'T23:59:59Z')
        }
      },
      orderBy: { date: 'asc' }
    });

    console.log(`Found ${records.length} records for ${targetDate}.`);
    
    records.forEach(r => {
      console.log(`Date: ${r.date.toISOString()} | User: ${r.createdBy} | Amount: ${r.amount}`);
    });

    console.log('\n--- ANALYZING USERS ---');
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true }
    });
    console.log('Registered users:');
    console.log(JSON.stringify(users, null, 2));

  } catch (error) {
    console.error('Error during analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyze();
