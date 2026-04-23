import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function analyzeCorruptedData() {
  try {
    const clients = await prisma.client.findMany({
      select: {
        id: true,
        identificationNumber: true,
        phone1: true,
        firstName: true
      }
    });

    const withDotZeroID = clients.filter(c => c.identificationNumber.includes('.0'));
    const withDotZeroPhone = clients.filter(c => c.phone1.includes('.0'));
    const nineDigitID = clients.filter(c => c.identificationNumber.length === 9 && !c.identificationNumber.includes('.'));
    const nineDigitPhone = clients.filter(c => c.phone1.length === 9 && !c.phone1.includes('.'));

    console.log('--- DATA CORRUPTION ANALYSIS V2 ---');
    console.log(`Total clients: ${clients.length}`);
    console.log(`\nCORRUPTION TYPE: .0 AT THE END`);
    console.log(`- IDs with .0: ${withDotZeroID.length}`);
    console.log(`- Phones with .0: ${withDotZeroPhone.length}`);

    console.log(`\nCORRUPTION TYPE: MISSING LEADING ZERO (9 digits instead of 10)`);
    console.log(`- IDs with 9 digits: ${nineDigitID.length}`);
    console.log(`- Phones with 9 digits: ${nineDigitPhone.length}`);

    if (nineDigitID.length > 0) {
      console.log('\nSample 9-digit IDs (Missing leading zero):');
      nineDigitID.slice(0, 5).forEach(c => {
        console.log(`- ${c.identificationNumber} (Name: ${c.firstName})`);
      });
    }

    if (nineDigitPhone.length > 0) {
      console.log('\nSample 9-digit Phones (Missing leading zero):');
      nineDigitPhone.slice(0, 5).forEach(c => {
        console.log(`- ${c.phone1} (Name: ${c.firstName})`);
      });
    }

  } catch (error) {
    console.error('Error during analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeCorruptedData();
