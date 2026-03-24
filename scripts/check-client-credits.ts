import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkClientCredits() {
  try {
    // Find the most recent client with wallet recharges
    const recentClient = await prisma.client.findFirst({
      where: {
        clientAccount: {
          totalCreditAvailable: { gt: 0 }
        }
      },
      select: {
        id: true,
        firstName: true,
        clientAccount: {
          select: {
            totalCreditAvailable: true,
            credits: {
              where: {
                status: 'AVAILABLE',
                remainingAmount: { gt: 0 }
              },
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                amount: true,
                remainingAmount: true,
                originTransactionId: true,
                createdAt: true
              }
            }
          }
        }
      }
    });

    if (!recentClient) {
      console.log('No client found with available credit');
      return;
    }

    console.log('\n=== CLIENT INFO ===');
    console.log(`Client ID: ${recentClient.id}`);
    console.log(`Name: ${recentClient.firstName}`);
    console.log(`Total Credit: ${recentClient.clientAccount?.totalCreditAvailable}`);
    
    console.log('\n=== AVAILABLE CREDITS ===');
    const credits = recentClient.clientAccount?.credits || [];
    
    if (credits.length === 0) {
      console.log('No available credits found');
      return;
    }

    for (const credit of credits) {
      console.log(`\nCredit ID: ${credit.id}`);
      console.log(`  Amount: ${credit.amount}`);
      console.log(`  Remaining: ${credit.remainingAmount}`);
      console.log(`  Origin Transaction ID: ${credit.originTransactionId}`);
      console.log(`  Created: ${credit.createdAt}`);

      // Check if origin FR exists
      const originFR = await prisma.financialRecord.findUnique({
        where: { id: credit.originTransactionId },
        select: {
          id: true,
          bankAccountId: true,
          paymentMethod: true,
          amount: true,
          movementType: true,
          bankAccount: {
            select: {
              name: true,
              type: true
            }
          }
        }
      });

      if (originFR) {
        console.log(`  ✓ Origin FR found:`);
        console.log(`    - Bank Account ID: ${originFR.bankAccountId}`);
        console.log(`    - Bank Account: ${originFR.bankAccount.name} (${originFR.bankAccount.type})`);
        console.log(`    - Payment Method: ${originFR.paymentMethod}`);
        console.log(`    - Movement Type: ${originFR.movementType}`);
        console.log(`    - Amount: ${originFR.amount}`);
      } else {
        console.log(`  ✗ Origin FR NOT FOUND - this credit cannot be traced!`);
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkClientCredits();
