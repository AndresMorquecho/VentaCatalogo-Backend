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

    const corruptedId = clients.filter(c => c.identificationNumber.includes('.0'));
    const corruptedPhone = clients.filter(c => c.phone1.includes('.0'));

    console.log('--- DATA CORRUPTION ANALYSIS ---');
    console.log(`Total clients: ${clients.length}`);
    console.log(`Clients with corrupted ID (.0): ${corruptedId.length}`);
    console.log(`Clients with corrupted Phone (.0): ${corruptedPhone.length}`);

    if (corruptedId.length > 0) {
      console.log('\nSample corrupted IDs:');
      corruptedId.slice(0, 5).forEach(c => {
        console.log(`- ${c.identificationNumber} (Name: ${c.firstName})`);
      });
    }

    if (corruptedPhone.length > 0) {
      console.log('\nSample corrupted Phones:');
      corruptedPhone.slice(0, 5).forEach(c => {
        console.log(`- ${c.phone1} (Name: ${c.firstName})`);
      });
    }

    // Check for potential collisions
    const fixableIds = corruptedId.map(c => {
        let fixed = c.identificationNumber.replace('.0', '');
        if (fixed.length === 9) fixed = '0' + fixed;
        return { id: c.id, original: c.identificationNumber, fixed };
    });

    const existingIds = new Set(clients.map(c => c.identificationNumber));
    const collisions = fixableIds.filter(f => existingIds.has(f.fixed));

    console.log(`\nPotential ID collisions after fix: ${collisions.length}`);
    if (collisions.length > 0) {
        console.log('Samples of collisions (ID already exists in correct format):');
        collisions.slice(0, 5).forEach(c => console.log(`- ${c.original} -> ${c.fixed}`));
    }

  } catch (error) {
    console.error('Error during analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeCorruptedData();
