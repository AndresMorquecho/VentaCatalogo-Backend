const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const dto = {
    resourceId: 'OR-2026-007',
    resourceType: 'ORDER_RECEIPT',
    userId: '18aca8cd-74cd-4809-ad00-0a0e71584e82', // The one from the DB
    userName: 'admin'
  };

  try {
    const now = new Date();
    console.log('--- 1. Deleting expired locks ---');
    const del = await prisma.systemLock.deleteMany({
        where: { expiresAt: { lt: now } }
    });
    console.log('Deleted:', del.count);

    console.log('--- 2. Finding unique lock ---');
    const existingLock = await prisma.systemLock.findUnique({
        where: {
            resourceId_resourceType: {
                resourceId: dto.resourceId,
                resourceType: dto.resourceType
            }
        }
    });
    console.log('Existing:', JSON.stringify(existingLock, null, 2));

    if (existingLock) {
        console.log('--- 3. Updating lock ---');
        const updated = await prisma.systemLock.update({
            where: { id: existingLock.id },
            data: { expiresAt: new Date(now.getTime() + 2 * 60000) }
        });
        console.log('Updated:', JSON.stringify(updated, null, 2));
    }
  } catch (err) {
    console.error('CRITICAL REPRODUCTION ERROR:', err);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
