import { prisma } from '../src/lib/prisma';

async function checkWalletPayments() {
  console.log('🔍 Checking wallet payment financial records...\n');

  // Get all financial records with BILLETERA_VIRTUAL
  const walletRecords = await prisma.financialRecord.findMany({
    where: {
      paymentMethod: 'BILLETERA_VIRTUAL'
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: 10,
    select: {
      id: true,
      referenceNumber: true,
      amount: true,
      date: true,
      clientName: true,
      orderId: true,
      userReference: true,
      movementType: true,
      source: true,
      balanceBefore: true,
      balanceAfter: true,
      createdAt: true
    }
  });

  console.log(`Found ${walletRecords.length} wallet payment records:\n`);

  for (const record of walletRecords) {
    console.log('─'.repeat(80));
    console.log(`ID: ${record.id}`);
    console.log(`Reference: ${record.referenceNumber}`);
    console.log(`User Reference (Receipt): ${record.userReference || 'N/A'}`);
    console.log(`Amount: $${record.amount}`);
    console.log(`Client: ${record.clientName}`);
    console.log(`Order ID: ${record.orderId || 'N/A'}`);
    console.log(`Movement Type: ${record.movementType}`);
    console.log(`Source: ${record.source}`);
    console.log(`Balance: ${record.balanceBefore} → ${record.balanceAfter}`);
    console.log(`Date: ${record.date}`);
    console.log(`Created: ${record.createdAt}`);
    console.log('');
  }

  // Check ALL recent financial records
  const allRecent = await prisma.financialRecord.findMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: 20,
    select: {
      id: true,
      referenceNumber: true,
      amount: true,
      clientName: true,
      paymentMethod: true,
      movementType: true,
      source: true,
      createdAt: true
    }
  });

  console.log(`\n📋 All recent financial records (last 24h): ${allRecent.length}\n`);
  for (const record of allRecent) {
    console.log(`${record.createdAt.toISOString()} | ${record.paymentMethod || 'N/A'} | ${record.movementType} | ${record.source} | $${record.amount} | ${record.clientName}`);
  }

  await prisma.$disconnect();
}

checkWalletPayments().catch(console.error);
