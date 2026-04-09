
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function repairClient(clientId: string) {
  console.log(`--- Repairing Client Account: ${clientId} ---`);

  const clientAccount = await prisma.clientAccount.findUnique({
    where: { clientId },
    include: {
      credits: true
    }
  });

  if (!clientAccount) {
    console.log('Client Account not found');
    return;
  }

  const availableCreditsSum = clientAccount.credits
    .filter(c => c.status === 'AVAILABLE')
    .reduce((sum, c) => sum + Number(c.remainingAmount), 0);

  console.log(`Current totalCreditAvailable: ${clientAccount.totalCreditAvailable}`);
  console.log(`Correct available balance (from credits): ${availableCreditsSum}`);

  if (Number(clientAccount.totalCreditAvailable) !== availableCreditsSum) {
    console.log(`Updating summary field to ${availableCreditsSum}...`);
    await prisma.clientAccount.update({
      where: { id: clientAccount.id },
      data: { 
        totalCreditAvailable: availableCreditsSum,
        version: { increment: 1 }
      }
    });
    console.log('Update successful.');
  } else {
    console.log('Balances already match. No update needed.');
  }
}

const clientId = '62c57422-5f42-4218-998b-45d1133e2ce2';
repairClient(clientId).then(() => prisma.$disconnect());
