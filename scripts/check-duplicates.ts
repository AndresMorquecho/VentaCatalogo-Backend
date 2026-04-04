import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    try {
        const dupRefs = await prisma.$queryRaw`
            SELECT reference, COUNT(*) 
            FROM wallet_recharges 
            WHERE reference IS NOT NULL
            GROUP BY reference 
            HAVING COUNT(*) > 1
        `;
        const dupControls = await prisma.$queryRaw`
            SELECT control_validation, COUNT(*) 
            FROM wallet_recharges 
            WHERE control_validation IS NOT NULL
            GROUP BY control_validation 
            HAVING COUNT(*) > 1
        `;
        
        console.log('Duplicate References:', dupRefs);
        console.log('Duplicate Controls:', dupControls);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

check();
