import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function clean() {
    // 1. Delete most recent duplicates of reference
    await prisma.$executeRaw`
        DELETE FROM wallet_recharges 
        WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY reference ORDER BY created_at ASC) as r
                FROM wallet_recharges
                WHERE reference IS NOT NULL
            ) t
            WHERE r > 1
        )
    `;
    
    // 2. Delete most recent duplicates of controlValidation
    await prisma.$executeRaw`
        DELETE FROM wallet_recharges 
        WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY control_validation ORDER BY created_at ASC) as r
                FROM wallet_recharges
                WHERE control_validation IS NOT NULL
            ) t
            WHERE r > 1
        )
    `;
    
    console.log('Duplicates cleaned.');
    await prisma.$disconnect();
}
clean();
