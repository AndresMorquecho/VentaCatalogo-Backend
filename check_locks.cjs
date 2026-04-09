const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    try {
        console.log('--- Models in Prisma ---');
        console.log(Object.keys(prisma).filter(k => !k.startsWith('_') && !k.startsWith('$')));
        
        console.log('--- Checking SystemLock ---');
        const locks = await prisma.systemLock.findMany();
        console.log('Locks found:', locks.length);
        console.log(JSON.stringify(locks, null, 2));
    } catch (error) {
        console.error('ERROR checking locks:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}
run();
