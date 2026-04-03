
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const duplicates = await prisma.receptionBatch.findMany({
        where: { packingNumber: 'PK-2026-001' },
        orderBy: { createdAt: 'asc' }
    });
    
    for (let i = 1; i < duplicates.length; i++) {
        await prisma.receptionBatch.update({
            where: { id: duplicates[i].id },
            data: { packingNumber: `PK-2026-001-${i}` }
        });
        console.log(`Renamed duplicated PK-2026-001 to PK-2026-001-${i}`);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
