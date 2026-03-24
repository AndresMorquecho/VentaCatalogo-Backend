import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Migration script to fix ClientCredit.originTransactionId
 * 
 * PROBLEM:
 * - ClientCredit.originTransactionId was incorrectly set to WalletRecharge.id
 * - It should point to the INCOME FinancialRecord.id that generated the credit
 * 
 * SOLUTION:
 * - For each ClientCredit with invalid originTransactionId:
 *   1. Find the WalletRecharge with that ID
 *   2. Find the INCOME FinancialRecord for that recharge (by clientId, amount, date range)
 *   3. Update ClientCredit.originTransactionId to point to the correct FinancialRecord
 */
async function fixClientCreditOriginTransactionIds() {
  console.log('Starting migration: Fix ClientCredit.originTransactionId\n');

  try {
    // Find all ClientCredits
    const allCredits = await prisma.clientCredit.findMany({
      select: {
        id: true,
        originTransactionId: true,
        amount: true,
        createdAt: true,
        clientAccount: {
          select: {
            clientId: true
          }
        }
      }
    });

    console.log(`Found ${allCredits.length} ClientCredit records to check\n`);

    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const credit of allCredits) {
      try {
        // Check if originTransactionId points to a FinancialRecord
        const existingFR = await prisma.financialRecord.findUnique({
          where: { id: credit.originTransactionId }
        });

        if (existingFR) {
          console.log(`✓ Credit ${credit.id} - originTransactionId already valid`);
          skippedCount++;
          continue;
        }

        // originTransactionId is invalid - try to find the correct one
        console.log(`\n✗ Credit ${credit.id} - originTransactionId is INVALID`);
        console.log(`  Current originTransactionId: ${credit.originTransactionId}`);

        // Check if it's a WalletRecharge ID
        const walletRecharge = await prisma.walletRecharge.findUnique({
          where: { id: credit.originTransactionId }
        });

        if (walletRecharge) {
          console.log(`  Found WalletRecharge: ${walletRecharge.id}`);
          console.log(`    - Amount: ${walletRecharge.amount}`);
          console.log(`    - Client: ${walletRecharge.clientId}`);
          console.log(`    - Created: ${walletRecharge.createdAt}`);

          // Find the INCOME FinancialRecord for this recharge
          // Look for FR with:
          // - Same clientId
          // - Same amount
          // - movementType = 'INCOME'
          // - Created around the same time (within 1 minute)
          const timeWindow = 60000; // 1 minute in milliseconds
          const startTime = new Date(walletRecharge.createdAt.getTime() - timeWindow);
          const endTime = new Date(walletRecharge.createdAt.getTime() + timeWindow);

          const candidateFRs = await prisma.financialRecord.findMany({
            where: {
              clientId: walletRecharge.clientId,
              amount: walletRecharge.amount,
              movementType: 'INCOME',
              source: 'MANUAL',
              createdAt: {
                gte: startTime,
                lte: endTime
              }
            },
            orderBy: { createdAt: 'asc' }
          });

          if (candidateFRs.length === 0) {
            console.log(`  ✗ No matching INCOME FinancialRecord found`);
            errorCount++;
            continue;
          }

          if (candidateFRs.length > 1) {
            console.log(`  ⚠ Found ${candidateFRs.length} candidate FRs - using the first one`);
          }

          const correctFR = candidateFRs[0];
          console.log(`  ✓ Found correct FinancialRecord: ${correctFR.id}`);
          console.log(`    - Reference: ${correctFR.referenceNumber}`);
          console.log(`    - Bank Account: ${correctFR.bankAccountId}`);

          // Update the ClientCredit
          await prisma.clientCredit.update({
            where: { id: credit.id },
            data: { originTransactionId: correctFR.id }
          });

          console.log(`  ✓ Updated ClientCredit.originTransactionId to ${correctFR.id}`);
          fixedCount++;
        } else {
          console.log(`  ✗ originTransactionId doesn't point to WalletRecharge either`);
          console.log(`  This credit cannot be fixed automatically`);
          errorCount++;
        }
      } catch (error) {
        console.error(`  ✗ Error processing credit ${credit.id}:`, error);
        errorCount++;
      }
    }

    console.log('\n=== MIGRATION SUMMARY ===');
    console.log(`Total credits checked: ${allCredits.length}`);
    console.log(`Already valid (skipped): ${skippedCount}`);
    console.log(`Fixed: ${fixedCount}`);
    console.log(`Errors: ${errorCount}`);

    if (fixedCount > 0) {
      console.log('\n✓ Migration completed successfully!');
      console.log('You can now use wallet payments and the transaction cards will appear.');
    } else if (errorCount === 0) {
      console.log('\n✓ All ClientCredit records already have valid originTransactionId');
    } else {
      console.log('\n⚠ Some credits could not be fixed. Manual intervention may be required.');
    }

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
fixClientCreditOriginTransactionIds()
  .then(() => {
    console.log('\nMigration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nMigration script failed:', error);
    process.exit(1);
  });
