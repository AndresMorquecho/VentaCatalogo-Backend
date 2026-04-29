
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analyze() {
  try {
    const userId = '954a74bf-be56-44bf-8c71-4d6ca71f242b'; // JARM ID
    // Simulate what the controller/usecase does
    const requestedUser = await prisma.user.findUnique({ 
        where: { id: userId },
        select: { username: true }
    });
    
    console.log('Requested User:', requestedUser);

    const fromDate = new Date('2026-04-28T05:00:00.000Z'); // Approx start of day in ECU
    const toDate = new Date('2026-04-29T04:59:59.999Z'); // Approx end of day in ECU
    
    console.log(`Querying from ${fromDate.toISOString()} to ${toDate.toISOString()}`);

    const allAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } });
    const whereClause = {
        bankAccountId: { in: allAccounts.map(a => a.id) },
        date: { gte: fromDate, lte: toDate },
        createdBy: requestedUser.username
    };

    const movements = await prisma.financialRecord.findMany({
        where: whereClause,
        include: { client: true, bankAccount: true, order: true },
        orderBy: { date: 'desc' }
    });

    console.log(`Found ${movements.length} movements.`);
    movements.forEach(m => {
        console.log(` - ID: ${m.id} | Date: ${m.date.toISOString()} | Amount: ${m.amount}`);
    });

  } catch (error) {
    console.error('Error during analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyze();
